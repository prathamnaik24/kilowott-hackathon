import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Activity } from 'lucide-react';
import { Button, ErrorNote, inputClass } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@woopulse.dev');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-900">WooPulse CRM</h1>
            <p className="text-xs text-zinc-500">Customer operations for WooCommerce</p>
          </div>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-zinc-600">Email</span>
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-zinc-600">Password</span>
          <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>
        <ErrorNote error={error} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-xs text-zinc-400">Demo: admin@woopulse.dev / demo1234 (or agent@woopulse.dev)</p>
      </form>
    </div>
  );
}
