import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Truck } from 'lucide-react';
import { post } from './api';
import type { User } from './types';

interface LoginScreenProps { onLogin: (user: User, distributor: any) => void }
const DEMO = [
  { role: 'Gestor', email: 'gestor@logisticmaster.local' },
  { role: 'Despachante', email: 'despacho@logisticmaster.local' },
  { role: 'Motorista', email: 'motorista@logisticmaster.local' },
  { role: 'Vendedor', email: 'vendas@logisticmaster.local' }
];

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('gestor@logisticmaster.local');
  const [password, setPassword] = useState('Demo@123');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await post<{ user: User; distributor: any }>('/auth/login', { email, password });
      onLogin(result.user, result.distributor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally { setLoading(false); }
  };

  return (
    <div className="lm-login-shell">
      <div className="lm-login-left">
        <div className="lm-brand"><div className="lm-brand-mark">LM</div><div><strong>LogisticMaster</strong><small>LOGÍSTICA DE PONTA A PONTA</small></div></div>
        <div className="lm-login-copy">
          <span className="lm-eyebrow"><span className="lm-pulse" /> CENTRAL DE OPERAÇÕES</span>
          <h1>Carregue melhor.<br /><em>Entregue no controle.</em></h1>
          <p>Da entrada do pedido à confirmação no destino. Uma única operação para organizar carga, capacidade, rota e entrega.</p>
          <div className="lm-login-proof-grid">
            <div><Truck size={18}/><b>Frota sob controle</b><span>Peso, cubagem e disponibilidade</span></div>
            <div><ShieldCheck size={18}/><b>Operação rastreável</b><span>Registro e evidência das entregas</span></div>
          </div>
        </div>
        <div className="lm-login-footer">LOGISTICMASTER · PROTÓTIPO OPERACIONAL 1.0</div>
      </div>
      <div className="lm-login-right">
        <form onSubmit={submit} className="lm-login-card">
          <div className="lm-login-card-heading"><span className="lm-eyebrow">ACESSO À PLATAFORMA</span><h2>Bem-vindo de volta</h2><p>Entre com seu usuário corporativo para acessar a operação.</p></div>
          <label className="lm-field"><span>E-mail</span><div className="lm-input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required placeholder="nome@empresa.com" /></div></label>
          <label className="lm-field"><span>Senha</span><div className="lm-input-wrap"><LockKeyhole size={17}/><input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required placeholder="Sua senha"/><button type="button" className="lm-icon-button" onClick={() => setShowPassword(!showPassword)} aria-label="Mostrar senha">{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
          {error && <div className="lm-error">{error}</div>}
          <button disabled={loading} className="lm-primary-button lm-login-submit">{loading ? 'Validando acesso…' : 'Entrar na plataforma'}<ArrowRight size={17}/></button>
          <div className="lm-demo-access"><div className="lm-demo-title">ACESSOS DE DEMONSTRAÇÃO <span>senha: Demo@123</span></div>{DEMO.map(d => <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword('Demo@123'); }}><span>{d.role}</span><code>{d.email}</code></button>)}</div>
          <div className="lm-login-security"><ShieldCheck size={14}/> Sessão autenticada e permissões por perfil de usuário</div>
        </form>
      </div>
    </div>
  );
}
