import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Store, Users } from 'lucide-react';
import type { AuthResponse } from '../shared/types';
import { api, post } from './api';
import { ErrorNotice, Field, Modal, SubmitButton } from './components';

export function AuthDialog({onClose,onLogin}:{onClose:()=>void;onLogin:(result:AuthResponse)=>void}) {
  const [register,setRegister]=useState(false);
  const [owner,setOwner]=useState(false);
  const [config,setConfig]=useState<{ownerSetupRequired:boolean;demo:boolean}|null>(null);
  const [name,setName]=useState(''),[username,setUsername]=useState(''),[email,setEmail]=useState('');
  const [phone,setPhone]=useState(''),[password,setPassword]=useState(''),[setupCode,setSetupCode]=useState('');
  const [available,setAvailable]=useState<boolean|null>(null),[checking,setChecking]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;api<typeof config>('/config').then(v=>{if(active)setConfig(v)}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{
    if(!register || username.trim().length<3){setAvailable(null);setChecking(false);return;}
    let active=true;setAvailable(null);setChecking(true);
    const timer=setTimeout(()=>api<{available:boolean}>(`/auth/username?username=${encodeURIComponent(username)}`)
      .then(v=>{if(active)setAvailable(v.available)}).catch(()=>{if(active)setAvailable(null)})
      .finally(()=>{if(active)setChecking(false)}),350);
    return()=>{active=false;clearTimeout(timer)};
  },[username,register]);
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{
      const path=register ? owner ? '/setup/owner':'/auth/register':'/auth/login';
      const body=register ? {name,username,email,password,phone,...(owner?{setupCode}: {})}:{email,password};
      onLogin(await post<AuthResponse>(path,body));
    }catch(e){setError(e instanceof Error?e.message:'Could not sign in.')}finally{setBusy(false)}
  }
  function demo(isOwner:boolean){setEmail(isOwner?'owner@smartshop.local':'customer@smartshop.local');setPassword(isOwner?'SmartShop@123':'Customer@123');setRegister(false);setOwner(false);setError('')}
  return <Modal title={register ? owner ? 'Set up your shop owner.' : 'Create your account.' : 'Welcome back.'} eyebrow="YOUR SMARTSHOP ACCOUNT" onClose={onClose}>
    <p className="modal-intro">{register?'Use your own email and password. Contact verification is available from Your account after registration.':'Sign in to your owner or customer account.'}</p>
    <form className="form-stack" onSubmit={submit}>
      {register&&<>
        {config?.ownerSetupRequired&&<Field label="Account type"><select value={owner?'owner':'customer'} onChange={e=>setOwner(e.target.value==='owner')}><option value="customer">Customer</option><option value="owner">Shop owner — activation code required</option></select></Field>}
        {owner&&<Field label="Owner activation code" hint="On your Mac, run npm run owner:code. This code can activate the shop owner only once."><input value={setupCode} onChange={e=>setSetupCode(e.target.value)} required autoComplete="off" maxLength={128} placeholder="Code from your Mac"/></Field>}
        <Field label="Your name"><input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Full name"/></Field>
        <Field label="Username"><input value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" autoComplete="username" placeholder="Choose a unique username"/>
          <small className={available===true?'available-text':available===false?'unavailable-text':''} role="status">{checking?'Checking availability…':available===true?'This username is available':available===false?'This username is already taken':'Use letters, numbers and underscores.'}</small>
        </Field>
        <Field label="Phone number" hint="Use country code, for example +880. Verification is a separate step."><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={30} autoComplete="tel" placeholder="+8801…"/></Field>
      </>}
      <Field label="Email address"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} autoComplete="email" placeholder="you@example.com"/></Field>
      <Field label="Password"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={register?(owner?10:8):1} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder={register?`At least ${owner?10:8} characters`:'Your password'}/></Field>
      <ErrorNotice>{error}</ErrorNotice>
      <SubmitButton busy={busy} disabled={register&&(available===false||checking)}>{register?owner?'Create owner account':'Create customer account':'Sign in'}<ArrowRight size={17}/></SubmitButton>
    </form>
    <p className="auth-switch">{register?'Already have an account?':'New around here?'}<button onClick={()=>{setRegister(!register);setOwner(false);setError('')}}>{register?'Sign in':'Create an account'}</button></p>
    {config?.demo&&!register&&<div className="demo-accounts"><p>CLASS PREVIEW ACCOUNTS</p><span>These sample accounts stop working after a real owner is activated.</span><div><button type="button" onClick={()=>demo(true)}><Store size={16}/>Sample owner</button><button type="button" onClick={()=>demo(false)}><Users size={16}/>Sample customer</button></div></div>}
  </Modal>;
}
