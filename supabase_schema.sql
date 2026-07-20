-- ============================================================================
-- SUGO-STYLE SOCIAL & HOST EARNING APP: MASTER POSTGRESQL SCHEMA
-- Execute this script in the Supabase SQL Editor.
-- ============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. PROFILES TABLE
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    username text not null,
    avatar_url text,
    user_role text not null check (user_role in ('caller', 'host', 'admin')),
    balance integer not null default 100 check (balance >= 0),
    earnings_balance numeric(10,2) not null default 0.00 check (earnings_balance >= 0.00),
    msg_price_coins integer not null default 10 check (msg_price_coins >= 0),
    voice_price_coins integer not null default 150 check (voice_price_coins >= 0),
    video_price_coins integer not null default 350 check (video_price_coins >= 0),
    bank_name text,
    bank_account_iban text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- RLS Policies for Profiles
create policy "Allow public read-access to all profiles"
    on public.profiles for select
    using (true);

create policy "Allow users to update their own profiles"
    on public.profiles for update
    using (auth.uid() = id);

-- Trigger to automatically create a profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (
        id, 
        username, 
        avatar_url, 
        user_role, 
        balance, 
        earnings_balance
    )
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', 'User_' || substring(new.id::text from 1 for 6)),
        coalesce(
            new.raw_user_meta_data->>'avatar_url', 
            'https://api.dicebear.com/7.x/adventurer/svg?seed=' || new.id::text
        ),
        coalesce(new.raw_user_meta_data->>'user_role', 'caller'),
        case when (new.raw_user_meta_data->>'user_role') = 'host' then 0 else 100 end,
        0.00
    );
    return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();


-- 2. WITHDRAWAL REQUESTS TABLE
create table if not exists public.withdrawal_requests (
    id uuid default gen_random_uuid() primary key,
    host_id uuid references public.profiles(id) on delete cascade not null,
    amount numeric(10,2) not null check (amount > 0.00),
    bank_name text not null,
    iban text not null,
    status text not null default 'pending' check (status in ('pending', 'paid')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.withdrawal_requests enable row level security;

-- RLS Policies for Withdrawal Requests
create policy "Allow hosts to view their own withdrawal requests"
    on public.withdrawal_requests for select
    using (auth.uid() = host_id);

create policy "Allow hosts to insert their own withdrawal requests"
    on public.withdrawal_requests for insert
    with check (auth.uid() = host_id);

create policy "Allow admins full access to all requests"
    on public.withdrawal_requests for all
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and user_role = 'admin'
        )
    );


-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- RPC 1: Send dynamic chat message (Deduct caller coins, Credit host 50% cash)
-- $1 USD = 1000 Coins. 50% cash back = (msg_price / 1000) * 0.5 USD
create or replace function public.send_dynamic_chat_message(
    p_sender_id uuid,
    p_recipient_host_id uuid
)
returns json
language plpgsql
security definer
as $$
declare
    v_msg_price integer;
    v_sender_balance integer;
    v_earnings_added numeric(10,4);
    v_new_balance integer;
begin
    -- 1. Fetch recipient host's message price
    select msg_price_coins into v_msg_price
    from public.profiles
    where id = p_recipient_host_id and user_role = 'host';

    if v_msg_price is null then
        return json_build_object('success', false, 'error', 'Host not found or invalid role');
    end if;

    -- 2. Lock sender record to avoid race conditions
    select balance into v_sender_balance
    from public.profiles
    where id = p_sender_id
    for update;

    -- 3. Check for sufficient balance
    if v_sender_balance < v_msg_price then
        return json_build_object('success', false, 'error', 'Insufficient coins');
    end if;

    -- 4. Calculate 50% cash equivalent ($1 USD = 1000 coins)
    -- E.g. 10 coins cost $0.01 USD. Host earns 50% = $0.005 USD
    v_earnings_added := (v_msg_price::numeric / 1000.0) * 0.50;

    -- 5. Deduct coins from sender
    update public.profiles
    set balance = balance - v_msg_price
    where id = p_sender_id
    returning balance into v_new_balance;

    -- 6. Credit cash earnings to the host
    update public.profiles
    set earnings_balance = earnings_balance + v_earnings_added
    where id = p_recipient_host_id;

    -- Return JSON results
    return json_build_object(
        'success', true,
        'remaining_balance', v_new_balance,
        'earnings_added_usd', v_earnings_added
    );
end;
$$;


-- RPC 2: Credit host call earnings
create or replace function public.credit_host_call_earnings(
    p_host_id uuid,
    p_rate_per_minute numeric default 0.10
)
returns numeric
language plpgsql
security definer
as $$
declare
    v_new_earnings numeric(10,2);
begin
    update public.profiles
    set earnings_balance = earnings_balance + p_rate_per_minute
    where id = p_host_id
    returning earnings_balance into v_new_earnings;

    return v_new_earnings;
end;
$$;


-- RPC 3: Request host withdrawal
create or replace function public.request_host_withdrawal(
    p_host_id uuid,
    p_amount numeric,
    p_bank_name text,
    p_iban text
)
returns json
language plpgsql
security definer
as $$
declare
    v_current_balance numeric(10,2);
    v_new_balance numeric(10,2);
    v_request_id uuid;
begin
    -- Lock host profile for balance check
    select earnings_balance into v_current_balance
    from public.profiles
    where id = p_host_id and user_role = 'host'
    for update;

    if v_current_balance is null then
        return json_build_object('success', false, 'error', 'Host profile not found');
    end if;

    if v_current_balance < p_amount then
        return json_build_object('success', false, 'error', 'Insufficient earnings balance');
    end if;

    -- Deduct from host's earnings balance
    update public.profiles
    set earnings_balance = earnings_balance - p_amount
    where id = p_host_id
    returning earnings_balance into v_new_balance;

    -- Insert request
    insert into public.withdrawal_requests (host_id, amount, bank_name, iban, status)
    values (p_host_id, p_amount, p_bank_name, p_iban, 'pending')
    returning id into v_request_id;

    return json_build_object(
        'success', true,
        'request_id', v_request_id,
        'remaining_balance', v_new_balance
    );
end;
$$;


-- RPC 4: Approve host withdrawal (Admin only)
create or replace function public.approve_host_withdrawal(
    p_request_id uuid
)
returns json
language plpgsql
security definer
as $$
declare
    v_caller_role text;
    v_current_status text;
begin
    -- Determine caller's role
    select user_role into v_caller_role
    from public.profiles
    where id = auth.uid();

    if v_caller_role is null or v_caller_role != 'admin' then
        return json_build_object('success', false, 'error', 'Access denied: Admin role required');
    end if;

    -- Get request status
    select status into v_current_status
    from public.withdrawal_requests
    where id = p_request_id;

    if v_current_status is null then
        return json_build_object('success', false, 'error', 'Withdrawal request not found');
    end if;

    if v_current_status = 'paid' then
        return json_build_object('success', false, 'error', 'Request has already been approved and paid');
    end if;

    -- Update request status to 'paid'
    update public.withdrawal_requests
    set status = 'paid'
    where id = p_request_id;

    return json_build_object('success', true, 'status', 'paid');
end;
$$;
