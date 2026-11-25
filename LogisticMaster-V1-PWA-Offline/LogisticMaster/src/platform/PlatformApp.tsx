import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Boxes, Building2, ChevronDown, ClipboardList, Compass, LayoutDashboard,
  LogOut, MapPinned, Menu, Settings, ShieldCheck, Truck, Users, Waypoints
} from 'lucide-react';
import { INITIAL_ORDERS, INITIAL_VEHICLES } from '../data/mockData';
import { api, post, put } from './api';
import { LoginScreen } from './LoginScreen';
import { flushMutations, readOfflineSnapshot, saveOfflineSnapshot } from './offlineQueue';
import type { CommunicationMessage, Config, Order, Retailer, Route, User, Vehicle } from './types';
import {
  CustomersView, DispatchView, DriverView, FleetView, IntegrationsView, MapView,
  OrdersView, OverviewView, SettingsView, UsersView
} from './Views';
import './platform.css';

type Tab = 'overview'|'orders'|'customers'|'fleet'|'dispatch'|'map'|'driver'|'integrations'|'users'|'settings';
const tabTitle: Record<Tab,string> = {
  overview:'Visão do proprietário',orders:'Pedidos',customers:'Clientes',fleet:'Frota',dispatch:'Central de despacho',
  map:'Mapa operacional',driver:'Minha rota',integrations:'Integrações',users:'Usuários e acessos',settings:'Configurações'
};
const DEFAULT_CONFIG: Config = {
  dieselPricePerLiter:7.77,crewHourlyRate:40,redeliveryDistanceKm:30,avgFuelEfficiencyKmL:8,
  redeliveryFixedTimeHours:1.5,reverseProcessingCost:10,minProfitMarginPct:12,defaultUnloadMinutes:15,
  geofenceRadiusMeters:30,trafficDelayThresholdMinutes:15,offlineWindowHours:4,maxVehicleUtilizationPct:90
};

export default function PlatformApp() {
  const [user,setUser]=useState<User|null>(null);const [distributor,setDistributor]=useState<any>(null);
  const [orders,setOrders]=useState<Order[]>([]);const [vehicles,setVehicles]=useState<Vehicle[]>([]);
  const [customers,setCustomers]=useState<Retailer[]>([]);const [routes,setRoutes]=useState<Route[]>([]);
  const [config,setConfig]=useState<Config>(DEFAULT_CONFIG);const [users,setUsers]=useState<any[]>([]);const [communications,setCommunications]=useState<CommunicationMessage[]>([]);
  const [active,setActive]=useState<Tab>('overview');const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState('');const [toastError,setToastError]=useState(false);const [mobileNav,setMobileNav]=useState(false);

  const notify=useCallback((message:string,isError=false)=>{setToast(message);setToastError(isError);window.setTimeout(()=>setToast(''),4200);},[]);

  const loadData=useCallback(async()=>{
    const result=await api<any>('/bootstrap');
    if(result.needsDemoSeed){
      const seedOrders=INITIAL_ORDERS.map(o=>({...o,status:o.status==='bloqueio_fiscal'?'bloqueio_fiscal':'pendente',truckId:undefined,lifoPosition:undefined,lat:null,lng:null}));
      const seedVehicles=INITIAL_VEHICLES.map(v=>({...v,status:'disponivel',currentWeightKg:0,currentVolumeM3:0,allocatedOrders:[],lat:null,lng:null}));
      await post('/bootstrap/seed',{orders:seedOrders,vehicles:seedVehicles});
      const fresh=await api<any>('/bootstrap');
      setOrders(fresh.orders||[]);setVehicles(fresh.vehicles||[]);setCustomers(fresh.retailers||[]);setRoutes(fresh.routes||[]);setConfig({...DEFAULT_CONFIG,...fresh.config});setCommunications(fresh.communications||[]);
      saveOfflineSnapshot(fresh).catch(()=>undefined);
    } else {
      setOrders(result.orders||[]);setVehicles(result.vehicles||[]);setCustomers(result.retailers||[]);setRoutes(result.routes||[]);setConfig({...DEFAULT_CONFIG,...result.config});setCommunications(result.communications||[]);
      saveOfflineSnapshot(result).catch(()=>undefined);
    }
  },[]);

  const refreshAll=useCallback(async()=>{
    await loadData();
    if(user?.role==='MANAGER'){
      const list=await api<any[]>('/users');setUsers(list);
    }
  },[loadData,user?.role]);

  useEffect(()=>{
    let mounted=true;
    api<any>('/auth/me').then(async result=>{
      if(!mounted)return;setUser(result.user);setDistributor(result.distributor);if(result.user.role==='DRIVER')localStorage.setItem('lm_offline_driver',JSON.stringify({user:result.user,distributor:result.distributor,expiresAt:Date.now()+4*60*60*1000}));
      setActive(result.user.role==='DRIVER'?'driver':result.user.role==='MANAGER'?'overview':'orders');
      await loadData();
      if(result.user.role==='MANAGER'){const list=await api<any[]>('/users');if(mounted)setUsers(list);}
    }).catch(async()=>{
      try {
        const offlineAccess=JSON.parse(localStorage.getItem('lm_offline_driver')||'null');
        const cachedUser=(offlineAccess?.expiresAt>Date.now()?offlineAccess.user:null) as User|null;
        if(cachedUser?.role==='DRIVER'){
          if(offlineAccess?.expiresAt<=Date.now())localStorage.removeItem('lm_offline_driver');
          const cached=await readOfflineSnapshot<any>();
          if(cached&&mounted){setUser(cachedUser);setDistributor(offlineAccess?.distributor||null);setOrders(cached.orders||[]);setVehicles(cached.vehicles||[]);setCustomers(cached.retailers||[]);setRoutes(cached.routes||[]);setConfig({...DEFAULT_CONFIG,...cached.config});setCommunications(cached.communications||[]);setActive('driver');}
        }
      } catch { /* sem sessão/cache local, mantém a tela de login */ }
    }).finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[loadData]);

  useEffect(()=>{
    const sync=async()=>{
      try{const result=await flushMutations();if(result.synced>0){await loadData();notify(`${result.synced} ação(ões) offline sincronizada(s).`);}}
      catch { /* tenta novamente quando a rede estiver estável */ }
    };
    window.addEventListener('online',sync);
    if(navigator.onLine&&user?.role==='DRIVER')sync();
    return()=>window.removeEventListener('online',sync);
  },[user?.role,loadData,notify]);

  useEffect(()=>{
    if(!user || !['MANAGER','DISPATCHER'].includes(user.role) || active!=='dispatch') return;
    let cancelled=false;
    const poll=async()=>{try{const latest=await api<CommunicationMessage[]>('/communications');if(!cancelled){setCommunications(latest);const cached=await readOfflineSnapshot<any>();if(cached)await saveOfflineSnapshot({...cached,communications:latest});}}catch{/* mantém a última leitura válida */}};
    poll();
    const timer=window.setInterval(poll,10000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[user?.role,active]);

  useEffect(()=>{
    if(user?.role!=='DRIVER' || active!=='driver') return;
    let cancelled=false;
    const poll=async()=>{try{const latest=await api<CommunicationMessage[]>('/communications');if(!cancelled){setCommunications(latest);const cached=await readOfflineSnapshot<any>();if(cached)await saveOfflineSnapshot({...cached,communications:latest});}}catch{/* offline: conserva a última mensagem recebida */}};
    poll();
    const timer=window.setInterval(poll,7000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[user?.role,active]);

  const handleLogin=async(nextUser:User,nextDistributor:any)=>{
    setUser(nextUser);setDistributor(nextDistributor);if(nextUser.role==='DRIVER')localStorage.setItem('lm_offline_driver',JSON.stringify({user:nextUser,distributor:nextDistributor,expiresAt:Date.now()+4*60*60*1000}));sessionStorage.setItem('lm_user',JSON.stringify(nextUser));sessionStorage.setItem('lm_distributor',JSON.stringify(nextDistributor));setLoading(true);
    setActive(nextUser.role==='DRIVER'?'driver':nextUser.role==='MANAGER'?'overview':'orders');
    try{await loadData();if(nextUser.role==='MANAGER')setUsers(await api<any[]>('/users'));}
    catch(err){notify(err instanceof Error?err.message:'Falha ao carregar os dados.',true);}
    finally{setLoading(false);}
  };
  const logout=async()=>{try{await post('/auth/logout',{});}catch{}sessionStorage.removeItem('lm_user');sessionStorage.removeItem('lm_distributor');localStorage.removeItem('lm_offline_driver');setUser(null);setDistributor(null);setOrders([]);setVehicles([]);setCustomers([]);setRoutes([]);setUsers([]);};

  const allowedTabs=useMemo(()=>{
    if(!user)return [] as Tab[];
    const all:[Tab,string,React.ReactNode][]=[
      ['overview','Visão do proprietário',<LayoutDashboard/>],['orders','Pedidos',<ClipboardList/>],['customers','Clientes',<Building2/>],
      ['fleet','Frota',<Truck/>],['dispatch','Central de despacho',<Boxes/>],['map','Mapa operacional',<MapPinned/>],
      ['driver','Minha rota',<Compass/>],['integrations','Integrações',<Waypoints/>],['users','Usuários e acessos',<Users/>],['settings','Configurações',<Settings/>]
    ];
    const rules:Record<User['role'],Tab[]>={
      MANAGER:['overview','orders','customers','fleet','dispatch','map','driver','integrations','users','settings'],
      DISPATCHER:['orders','customers','fleet','dispatch','map','driver'],
      DRIVER:['driver'],
      SALES_REP:['orders','customers']
    };
    return all.filter(([key])=>rules[user.role].includes(key)).map(([key])=>key);
  },[user]);

  const handleNavigate=(tab:string)=>{if(allowedTabs.includes(tab as Tab)){setActive(tab as Tab);setMobileNav(false);}};
  const handleConfigSave=async(next:Config)=>{const saved=await put<Config>('/config',next);setConfig(saved);};

  if(loading)return <div className="lm-loading">LOGISTICMASTER · INICIALIZANDO OPERAÇÃO…</div>;
  if(!user)return <LoginScreen onLogin={handleLogin}/>;

  const occupancy=vehicles.length?vehicles.reduce((s,v)=>s+(v.currentWeightKg/Math.max(1,v.maxWeightKg)*100+v.currentVolumeM3/Math.max(1,v.maxVolumeM3)*100)/2,0)/vehicles.length:0;
  const navIcon=(tab:Tab)=>{
    const icons:Record<Tab,React.ReactNode>={overview:<LayoutDashboard/>,orders:<ClipboardList/>,customers:<Building2/>,fleet:<Truck/>,dispatch:<Boxes/>,map:<MapPinned/>,driver:<Compass/>,integrations:<Waypoints/>,users:<Users/>,settings:<Settings/>};
    return icons[tab];
  };
  const renderPage=()=>{
    switch(active){
      case 'overview':return <OverviewView orders={orders} vehicles={vehicles} routes={routes} config={config} user={user} onNavigate={handleNavigate}/>;
      case 'orders':return <OrdersView orders={orders} onRefresh={refreshAll} onToast={notify} canEdit={['MANAGER','DISPATCHER','SALES_REP'].includes(user.role)}/>;
      case 'customers':return <CustomersView customers={customers} onRefresh={refreshAll} onToast={notify} canEdit={user.role!=='DRIVER'}/>;
      case 'fleet':return <FleetView vehicles={vehicles} onRefresh={refreshAll} onToast={notify} canEdit={['MANAGER','DISPATCHER'].includes(user.role)}/>;
      case 'dispatch':return <DispatchView orders={orders} vehicles={vehicles} routes={routes} communications={communications} config={config} canOverride={user.role==='MANAGER'} onRefresh={refreshAll} onToast={notify}/>;
      case 'map':return <MapView orders={orders} vehicles={vehicles} onRefresh={refreshAll} onToast={notify}/>;
      case 'driver':return <DriverView orders={orders} vehicles={vehicles} communications={communications} user={user} onRefresh={refreshAll} onToast={notify}/>;
      case 'integrations':return <IntegrationsView onToast={notify}/>;
      case 'users':return <UsersView users={users} onRefresh={async()=>setUsers(await api<any[]>('/users'))} onToast={notify} currentUser={user}/>;
      case 'settings':return <SettingsView config={config} user={user} onSave={handleConfigSave} onToast={notify}/>;
      default:return <OverviewView orders={orders} vehicles={vehicles} routes={routes} config={config} user={user} onNavigate={handleNavigate}/>;
    }
  };

  return <div className="lm-app">
    <aside className={`lm-sidebar ${mobileNav?'is-open':''}`}>
      <div className="lm-brand"><div className="lm-brand-mark">LM</div><div><strong>LogisticMaster</strong><small>LOGÍSTICA DE PONTA A PONTA</small></div></div>
      <div className="lm-side-tenant"><small>AMBIENTE OPERACIONAL</small><b>{distributor?.trade_name||'Minha distribuidora'}</b><span>● Conta ativa</span></div>
      <div className="lm-side-section">MENU PRINCIPAL</div>
      <nav className="lm-nav">{allowedTabs.map(tab=><button key={tab} onClick={()=>handleNavigate(tab)} className={`lm-nav-button ${active===tab?'active':''}`} title={tabTitle[tab]}>{navIcon(tab)}<span>{tabTitle[tab]}</span></button>)}</nav>
      <div className="lm-sidebar-bottom"><div className="lm-side-user"><div className="lm-user-avatar">{user.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div><div><b>{user.name}</b><small>{user.role==='MANAGER'?'Gestor / Proprietário':user.role==='DISPATCHER'?'Despachante':user.role==='DRIVER'?'Motorista':'Vendedor'}</small></div><button className="lm-logout" title="Sair" onClick={logout}><LogOut size={15}/></button></div></div>
    </aside>
    {mobileNav&&<button className="lm-mobile-scrim" aria-label="Fechar menu" onClick={()=>setMobileNav(false)} />}
    <div className="lm-main">
      <header className="lm-topbar"><div className="lm-breadcrumb"><button className="lm-mobile-menu" onClick={()=>setMobileNav(!mobileNav)}><Menu size={18}/></button><span>LogisticMaster</span><ChevronDown size={12}/><b>{tabTitle[active]}</b></div><div className="lm-topbar-right"><span className="lm-top-pill"><i/> API conectada</span><span className="lm-top-pill"><Activity size={13}/> Ocupação {Math.round(occupancy)}%</span><button className="lm-icon-button" title="Atualizar dados" onClick={()=>refreshAll().catch(e=>notify(e.message,true))}><RefreshIcon/></button><button className="lm-icon-button" title="Sair" onClick={logout}><LogOut size={16}/></button></div></header>
      <main className="lm-content">{renderPage()}</main>
      <footer className="lm-app-footer"><span>LOGISTICMASTER · PROTÓTIPO FUNCIONAL</span><span>Dados persistidos em banco local SQLite · Perfis {user.role}</span></footer>
    </div>
    {toast&&<div className={`lm-toast ${toastError?'is-error':''}`}><ShieldCheck size={16}/>{toast}</div>}
  </div>;
}
function RefreshIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2"/></svg>}
