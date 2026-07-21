-- ================================================================
-- COOMEET-STYLE VIDEO CHAT PLATFORM - SUPABASE SQL SCRIPT
-- Execute in Supabase SQL Editor.
-- ================================================================

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_url text,
  gender text not null check (gender in ('male', 'female')),
  is_admin boolean default false,
  balance integer default 1000 check (balance >= 0),
  earnings_balance numeric(10,2) default 0.00 check (earnings_balance >= 0.00),
  msg_price_coins integer default 10 check (msg_price_coins >= 0),
  video_price_coins integer default 350 check (video_price_coins >= 0),
  bank_name text,
  bank_iban text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  female_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0.00),
  bank_name text not null,
  iban text not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz default now()
);

alter table public.withdrawal_requests enable row level security;

create policy "Users can view their own withdrawals" on public.withdrawal_requests for select using (auth.uid() = female_id);
create policy "Users can create their own withdrawals" on public.withdrawal_requests for insert with check (auth.uid() = female_id);
create policy "Admins can access all withdrawals" on public.withdrawal_requests for all using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (
    id,
    username,
    avatar_url,
    gender,
    is_admin,
    balance,
    earnings_balance,
    msg_price_coins,
    video_price_coins
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'avatar_url', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300'),
    coalesce(new.raw_user_meta_data->>'gender', 'male'),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false),
    case when coalesce(new.raw_user_meta_data->>'gender', 'male') = 'male' then 1000 else 0 end,
    0.00,
    10,
    350
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.send_chat_message(p_male_id uuid, p_female_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_msg_price int;
  v_male_balance int;
  v_new_balance int;
  v_earnings_added numeric(10,4);
begin
  select msg_price_coins into v_msg_price from public.profiles where id = p_female_id and gender = 'female';
  if v_msg_price is null then
    return json_build_object('success', false, 'error', 'Female profile not found');
  end if;

  select balance into v_male_balance from public.profiles where id = p_male_id and gender = 'male' for update;
  if v_male_balance is null then
    return json_build_object('success', false, 'error', 'Male profile not found');
  end if;

  if v_male_balance < v_msg_price then
    return json_build_object('success', false, 'error', 'Insufficient balance');
  end if;

  v_earnings_added := (v_msg_price::numeric / 1000.0) * 0.50;

  update public.profiles set balance = balance - v_msg_price where id = p_male_id;
  update public.profiles set earnings_balance = earnings_balance + v_earnings_added where id = p_female_id;

  select balance into v_new_balance from public.profiles where id = p_male_id;

  return json_build_object('success', true, 'remaining_balance', v_new_balance);
end;
$$;

create or replace function public.credit_female_call_minute(p_female_id uuid, p_rate numeric default 0.10)
returns numeric
language plpgsql
security definer
as $$
declare
  v_new_earnings numeric(10,2);
begin
  update public.profiles set earnings_balance = earnings_balance + p_rate where id = p_female_id returning earnings_balance into v_new_earnings;
  return v_new_earnings;
end;
$$;

create or replace function public.request_payout(p_female_id uuid, p_amount numeric, p_bank_name text, p_iban text)
returns json
language plpgsql
security definer
as $$
declare
  v_current_balance numeric(10,2);
  v_new_balance numeric(10,2);
  v_request_id uuid;
begin
  select earnings_balance into v_current_balance from public.profiles where id = p_female_id and gender = 'female' for update;
  if v_current_balance is null then
    return json_build_object('success', false, 'error', 'Female profile not found');
  end if;
  if v_current_balance < p_amount then
    return json_build_object('success', false, 'error', 'Insufficient earnings balance');
  end if;

  update public.profiles set earnings_balance = earnings_balance - p_amount where id = p_female_id returning earnings_balance into v_new_balance;
  insert into public.withdrawal_requests (female_id, amount, bank_name, iban, status)
  values (p_female_id, p_amount, p_bank_name, p_iban, 'pending') returning id into v_request_id;

  return json_build_object('success', true, 'request_id', v_request_id, 'remaining_balance', v_new_balance);
end;
$$;

create or replace function public.approve_payout(p_request_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_is_admin boolean;
  v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if v_is_admin is not true then
    return json_build_object('success', false, 'error', 'Admin access required');
  end if;

  select status into v_status from public.withdrawal_requests where id = p_request_id;
  if v_status is null then
    return json_build_object('success', false, 'error', 'Request not found');
  end if;
  if v_status = 'paid' then
    return json_build_object('success', false, 'error', 'Already paid');
  end if;

  update public.withdrawal_requests set status = 'paid' where id = p_request_id;
  return json_build_object('success', true, 'status', 'paid');
end;
$$;
