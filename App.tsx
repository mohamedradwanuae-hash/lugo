import React, { useEffect, useState } from 'react';
import './src/index.css';

type User = {
  id: string;
  username: string;
  email: string;
  gender: 'male' | 'female' | 'admin';
  balance?: number;
  earnings_balance?: number;
  msg_price_coins?: number;
  video_price_coins?: number;
  is_admin?: boolean;
};

const AD_APP_ID = 'ca-app-pub-8274833606013878~6815476313';
const AD_UNIT_ID = 'ca-app-pub-8274833606013878/2549642251';
const AD_CLIENT_ID = 'ca-pub-8274833606013878';

type Profile = {
  id: string;
  username: string;
  avatarUrl: string;
  city: string;
  age: number;
  bio: string;
  isOnline: boolean;
  rating: number;
  followers: number;
  msgPrice: number;
  videoPrice: number;
  earnings: number;
};

type Withdrawal = {
  id: string;
  femaleId: string;
  femaleName: string;
  amount: number;
  bankName: string;
  iban: string;
  status: string;
};

async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('lugo-token');
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authForm, setAuthForm] = useState({ username: '', email: '', identifier: '', password: '', gender: 'male' as 'male' | 'female' });
  const [status, setStatus] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [payoutForm, setPayoutForm] = useState({ amount: '', bankName: '', iban: '' });
  const [pricingForm, setPricingForm] = useState({ msgPrice: '10', videoPrice: '350' });
  const [messageDraft, setMessageDraft] = useState('Hi, I would love to chat with you!');
  const [callTimer, setCallTimer] = useState(0);
  const [isCallActive, setIsCallActive] = useState(false);
  const [adModalOpen, setAdModalOpen] = useState(false);
  const [adStatus, setAdStatus] = useState<'idle' | 'loading' | 'watching' | 'complete' | 'error'>('idle');
  const [adCountdown, setAdCountdown] = useState(0);

  const refreshData = async () => {
    try {
      const [profilesResult, withdrawalsResult, messagesResult] = await Promise.all([
        request('/api/hosts'),
        request('/api/withdrawals'),
        request('/api/messages'),
      ]);
      setProfiles(profilesResult.hosts || []);
      setWithdrawals(withdrawalsResult.withdrawals || []);
      setMessages(messagesResult.messages || []);
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('lugo-user');
    const savedToken = localStorage.getItem('lugo-token');
    if (savedUser && savedToken) {
      const parsed = JSON.parse(savedUser);
      setUser(parsed);
      request('/api/auth/me')
        .then((result) => setUser(result.user))
        .catch(() => {
          localStorage.removeItem('lugo-user');
          localStorage.removeItem('lugo-token');
        });
    }
  }, []);

  useEffect(() => {
    if (user) {
      refreshData();
    }
  }, [user]);

  useEffect(() => {
    if (!isCallActive || !user || user.gender !== 'female') {
      return;
    }

    const interval = window.setInterval(() => {
      setCallTimer((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isCallActive, user]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (document.getElementById('admob-script')) {
      return;
    }

    const script = document.createElement('script');
    script.id = 'admob-script';
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT_ID}`;
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!isCallActive || !user || user.gender !== 'female') {
      return;
    }

    if (callTimer > 0 && callTimer % 60 === 0) {
      request('/api/video/credit-minute', {
        method: 'POST',
        body: JSON.stringify({ femaleId: user.id, rate: 0.1 }),
      })
        .then(() => {
          setStatus('Live call minute credited.');
          setUser((current) => current ? { ...current, earnings_balance: Number((Number(current.earnings_balance || 0) + 0.1).toFixed(2)) } : current);
        })
        .catch(() => undefined);
    }
  }, [callTimer, isCallActive, user]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('');
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const payload = authMode === 'signup'
        ? { username: authForm.username, email: authForm.email, password: authForm.password, gender: authForm.gender }
        : { identifier: authForm.identifier, password: authForm.password };

      const result = await request(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem('lugo-user', JSON.stringify(result.user));
      localStorage.setItem('lugo-token', result.token);
      setUser(result.user);
      setStatus(authMode === 'signup' ? 'Welcome aboard — your account is ready.' : 'Signed in successfully.');
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('lugo-user');
    localStorage.removeItem('lugo-token');
    setUser(null);
    setStatus('Signed out.');
  };

  const handleTopUp = async () => {
    try {
      const result = await request('/api/topup', {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id }),
      });
      setUser((current) => current ? { ...current, balance: result.balance } : current);
      setStatus('Coins topped up successfully.');
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const handleRewardAd = () => {
    if (!user) {
      setStatus('Please sign in first.');
      return;
    }

    setAdModalOpen(true);
    setAdStatus('loading');
    setAdCountdown(6);

    const adWindow = window as Window & { adsbygoogle?: Array<Record<string, unknown>> };
    if (adWindow.adsbygoogle) {
      try {
        adWindow.adsbygoogle.push({});
      } catch {
        // Ignore AdMob bootstrap issues and fall back to the built-in countdown.
      }
    }

    window.setTimeout(() => {
      setAdStatus('watching');
    }, 350);

    const timer = window.setInterval(() => {
      setAdCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setAdStatus('complete');
          setAdModalOpen(false);
          void (async () => {
            try {
              const result = await request('/api/topup', {
                method: 'POST',
                body: JSON.stringify({ userId: user.id, amount: 10 }),
              });
              setUser((current) => current ? { ...current, balance: result.balance } : current);
              setStatus('10 free coins added after the ad finished.');
            } catch (error: any) {
              setStatus(error.message);
            }
          })();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  };

  const handleSendMessage = async () => {
    if (!selectedProfile || !user) {
      setStatus('Pick a profile first.');
      return;
    }

    try {
      const result = await request('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ senderId: user.id, recipientId: selectedProfile.id, text: messageDraft }),
      });
      setUser((current) => current ? { ...current, balance: result.remainingBalance } : current);
      setMessages((current) => [
        { id: Date.now().toString(), senderName: user.username, text: messageDraft },
        ...current,
      ]);
      setStatus(`Message delivered — ${result.remainingBalance} coins left.`);
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const handleStartCall = (profile: Profile) => {
    setSelectedProfile(profile);
    setIsCallActive(true);
    setCallTimer(0);
    setStatus(`Live call started with ${profile.username}.`);
  };

  const handleSavePricing = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await request('/api/female/pricing', {
        method: 'POST',
        body: JSON.stringify({ femaleId: user?.id, msgPrice: Number(pricingForm.msgPrice), videoPrice: Number(pricingForm.videoPrice) }),
      });
      setUser((current) => current ? { ...current, msg_price_coins: result.msgPrice, video_price_coins: result.videoPrice } : current);
      setStatus('Pricing updated.');
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const handleRequestPayout = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await request('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({ femaleId: user?.id, amount: Number(payoutForm.amount), bankName: payoutForm.bankName, iban: payoutForm.iban }),
      });
      setWithdrawals((current) => [result.withdrawal, ...current]);
      setUser((current) => current ? { ...current, earnings_balance: result.remainingBalance } : current);
      setStatus('Payout request submitted.');
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const handleApproveWithdrawal = async (requestId: string) => {
    try {
      await request('/api/withdrawals/approve', {
        method: 'POST',
        body: JSON.stringify({ requestId, isAdmin: true }),
      });
      setStatus('Withdrawal marked as paid.');
      refreshData();
    } catch (error: any) {
      setStatus(error.message);
    }
  };

  const isFemale = user?.gender === 'female';
  const isAdmin = user?.gender === 'admin' || user?.is_admin;

  return (
    <main className="app-shell">
      {!user ? (
        <section className="card auth-card">
          <div className="brand-block">
            <p className="eyebrow">CooMeet-style</p>
            <h1>Discover live video chats and premium social connections</h1>
            <p>Create an account to browse profiles, message stars, or earn from your live sessions.</p>
          </div>

          <div className="toggle-row">
            <button className={authMode === 'signin' ? 'toggle active' : 'toggle'} onClick={() => setAuthMode('signin')} type="button">Sign in</button>
            <button className={authMode === 'signup' ? 'toggle active' : 'toggle'} onClick={() => setAuthMode('signup')} type="button">Sign up</button>
          </div>

          <form onSubmit={handleAuth} className="stack">
            {authMode === 'signup' && (
              <>
                <label>
                  <span>Username</span>
                  <input value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} placeholder="Choose a username" required />
                </label>
                <label>
                  <span>Email</span>
                  <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="Enter your email" required />
                </label>
              </>
            )}

            {authMode === 'signin' && (
              <label>
                <span>Email or username</span>
                <input value={authForm.identifier} onChange={(event) => setAuthForm({ ...authForm, identifier: event.target.value })} placeholder="Email or username" required />
              </label>
            )}

            <label>
              <span>Password</span>
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Enter password" required />
            </label>

            {authMode === 'signup' && (
              <div className="gender-picker">
                <button className={authForm.gender === 'male' ? 'toggle active' : 'toggle'} type="button" onClick={() => setAuthForm({ ...authForm, gender: 'male' })}>Male ♂</button>
                <button className={authForm.gender === 'female' ? 'toggle active' : 'toggle'} type="button" onClick={() => setAuthForm({ ...authForm, gender: 'female' })}>Female ♀</button>
              </div>
            )}

            <button className="primary-button" type="submit">{authMode === 'signup' ? 'Create account' : 'Sign in'}</button>
          </form>

          {status && <p className="status">{status}</p>}
        </section>
      ) : (
        <section className="dashboard">
          <header className="hero card">
            <div>
              <p className="eyebrow">{isFemale ? 'Female studio' : isAdmin ? 'Admin control desk' : 'Male lounge'}</p>
              <h2>{user.username}</h2>
              <p>{isFemale ? `$${Number(user.earnings_balance || 0).toFixed(2)} earned` : `${user.balance || 0} coins available`}</p>
            </div>
            <button className="secondary-button" onClick={handleSignOut} type="button">Sign out</button>
          </header>

          {adModalOpen && (
            <div className="modal-backdrop" onClick={() => setAdModalOpen(false)}>
              <div className="card ad-card" onClick={(event) => event.stopPropagation()}>
                <p className="eyebrow">Sponsored ad</p>
                <h3>Watch the ad to claim 10 coins</h3>
                <p className="muted">The reward is only granted after the ad-view step finishes.</p>
                <div className="ad-frame">
                  <div className="ad-placeholder">
                    <strong>AdMob unit ready</strong>
                    <span>App ID: {AD_APP_ID}</span>
                    <span>Unit ID: {AD_UNIT_ID}</span>
                  </div>
                  <ins
                    className="adsbygoogle"
                    style={{ display: 'block', width: '100%', minHeight: '180px' }}
                    data-ad-client={AD_CLIENT_ID}
                    data-ad-slot={AD_UNIT_ID}
                    data-ad-format="auto"
                    data-full-width-responsive="true"
                  />
                </div>
                <div className="ad-progress">Watch time: {adCountdown}s</div>
                <p className="muted">
                  {adStatus === 'loading' ? 'Loading your sponsored ad...' : adStatus === 'watching' ? 'The ad is playing now.' : 'Rewarding your account...'}
                </p>
                <button className="secondary-button" type="button" onClick={() => setAdModalOpen(false)}>Close</button>
              </div>
            </div>
          )}

          {isFemale ? (
            <div className="grid">
              <article className="card">
                <h3>My earnings</h3>
                <div className="stat-box">${Number(user.earnings_balance || 0).toFixed(2)}</div>
                <p className="muted">Live video calls instantly credit your account at $0.10 per minute.</p>
              </article>

              <article className="card">
                <h3>Pricing controls</h3>
                <form onSubmit={handleSavePricing} className="stack">
                  <label>
                    <span>Message price (coins)</span>
                    <input value={pricingForm.msgPrice} onChange={(event) => setPricingForm({ ...pricingForm, msgPrice: event.target.value })} />
                  </label>
                  <label>
                    <span>Video price (coins/minute)</span>
                    <input value={pricingForm.videoPrice} onChange={(event) => setPricingForm({ ...pricingForm, videoPrice: event.target.value })} />
                  </label>
                  <button className="primary-button" type="submit">Save pricing</button>
                </form>
              </article>

              <article className="card">
                <h3>Bank payout</h3>
                <form onSubmit={handleRequestPayout} className="stack">
                  <input placeholder="Cashout amount" value={payoutForm.amount} onChange={(event) => setPayoutForm({ ...payoutForm, amount: event.target.value })} required />
                  <input placeholder="Bank name" value={payoutForm.bankName} onChange={(event) => setPayoutForm({ ...payoutForm, bankName: event.target.value })} />
                  <input placeholder="IBAN / SWIFT" value={payoutForm.iban} onChange={(event) => setPayoutForm({ ...payoutForm, iban: event.target.value })} />
                  <button className="primary-button" type="submit">Request payout</button>
                </form>
              </article>

              <article className="card">
                <h3>Live call ticker</h3>
                <div className="stat-box">{Math.floor(callTimer / 60)}:{String(callTimer % 60).padStart(2, '0')}</div>
                <button className="primary-button" onClick={() => setIsCallActive((value) => !value)} type="button">{isCallActive ? 'Pause live session' : 'Start live session'}</button>
                <p className="muted">Every 60 seconds, your account receives a $0.10 credit.</p>
              </article>
            </div>
          ) : isAdmin ? (
            <div className="card">
              <h3>Admin payout approvals</h3>
              <div className="list">
                {withdrawals.map((entry) => (
                  <div key={entry.id} className="list-item">
                    <div>
                      <strong>{entry.femaleName}</strong>
                      <div>${entry.amount} · {entry.bankName} · {entry.status}</div>
                    </div>
                    <button className="secondary-button" onClick={() => handleApproveWithdrawal(entry.id)} type="button">Approve</button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid">
              <article className="card hero-panel">
                <div className="hero-actions">
                  <button className="primary-button" onClick={handleTopUp} type="button">Top up 1,000 coins</button>
                  <button className="secondary-button" onClick={handleRewardAd} type="button">Watch ad for 10 free coins</button>
                </div>
                <div className="stat-box">{user.balance || 0} coins</div>
                <p className="muted">Spend coins to message premium hosts or start a live private video chat.</p>
              </article>

              <article className="card">
                <h3>Live women online</h3>
                <div className="list">
                  {profiles.map((profile) => (
                    <div key={profile.id} className="profile-card">
                      <img src={profile.avatarUrl} alt={profile.username} />
                      <div>
                        <strong>{profile.username}</strong>
                        <div>{profile.city} · {profile.age}y</div>
                        <div>💬 {profile.msgPrice} coins · 🎥 {profile.videoPrice} coins/min</div>
                      </div>
                      <div className="profile-actions">
                        <button className="secondary-button" onClick={() => { setSelectedProfile(profile); setStatus(`Ready to message ${profile.username}.`); }} type="button">Message</button>
                        <button className="primary-button" onClick={() => handleStartCall(profile)} type="button">Video</button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card">
                <h3>Chat composer</h3>
                <textarea value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} />
                {selectedProfile && <p className="muted">Messaging {selectedProfile.username}</p>}
                <button className="primary-button" onClick={handleSendMessage} type="button">Send message</button>
                <div className="list">
                  {messages.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="list-item">
                      <strong>{entry.senderName}</strong>
                      <span>{entry.text}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card">
                <h3>Live preview</h3>
                <div className="video-card">
                  <div className="video-surface">
                    <p>{selectedProfile ? `Now connected to ${selectedProfile.username}` : 'Choose a profile to start a private stream'}</p>
                  </div>
                  <button className="primary-button" onClick={() => selectedProfile && handleStartCall(selectedProfile)} type="button">Start private call</button>
                </div>
              </article>
            </div>
          )}

          {status && <p className="status">{status}</p>}
        </section>
      )}
    </main>
  );
}
