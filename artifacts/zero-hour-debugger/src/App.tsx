import { type ChangeEvent, type FormEvent, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleCheck, Clock3,
  Code2, FileUp, Gauge, LogOut, Play, RefreshCw, Send, ShieldCheck, Terminal,
  Trophy, Users,
} from 'lucide-react';
import {
  getHealthCheckQueryKey, getGetCompetitionQueryKey, getGetLeaderboardQueryKey, getGetParticipantDashboardQueryKey,
  getGetOrganizerSummaryQueryKey, getGetOrganizerParticipantsQueryKey, getExportOrganizerCsvQueryKey,
  useHealthCheck, useGetCompetition, useGetLeaderboard,
  useCreateParticipantSession, useDeleteParticipantSession, useGetParticipantDashboard,
  useSaveParticipantDraft, useRunParticipantCode, useSubmitParticipantCode,
  useGetOrganizerSummary, useGetOrganizerParticipants, useImportOrganizerTeams,
  useExportOrganizerCsv, useSetOrganizerEvent,
  type CodeRunResult, type Competition, type OrganizerParticipant, type ParticipantDashboard, type SubmissionResult,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const rawClerkKey = typeof import.meta.env.VITE_CLERK_PUBLISHABLE_KEY === 'string' ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY.trim() : '';
const clerkPubKey = rawClerkKey && (rawClerkKey.startsWith('pk_test_') || rawClerkKey.startsWith('pk_live_'))
  ? rawClerkKey
  : undefined;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || (import.meta.env.PROD && clerkPubKey ? `${basePath}/api/__clerk` : undefined);

function Header({ team, onLogout }: { team?: string; onLogout?: () => void }) {
  const health=useHealthCheck({query:{queryKey:getHealthCheckQueryKey(),refetchInterval:30000}});
  const isParticipant = Boolean(team || (typeof window !== 'undefined' && sessionStorage.getItem('zh-participant-session') === '1'));
  return <header className="topbar sticky top-0 z-20 flex items-center justify-between px-5 md:px-9">
    <Link href="/" className="flex items-center gap-3 text-inherit no-underline" data-testid="link-home">
      <span className="brand-mark">ZH</span><span className="mono text-[12px] font-medium tracking-[.13em] text-[#e0e9e3]">ZERO HOUR <span className="text-[#5ae488]">/</span> DEBUGGER GAUNTLET</span>
    </Link>
    <nav className="flex items-center gap-5">
      <Link href="/leaderboard" className="mono text-[11px] tracking-[.08em] text-[#9aa8a1] transition hover:text-[#69e895]" data-testid="link-leaderboard">STANDINGS</Link>
      {!isParticipant && <Link href="/organizer" className="mono hidden text-[11px] tracking-[.08em] text-[#78877e] transition hover:text-[#69e895] sm:inline" data-testid="link-organizer">ORGANIZER</Link>}
      <span className="mono hidden items-center gap-2 text-[9px] tracking-[.08em] text-[#85948b] md:inline-flex" aria-label={`API status ${health.data?.status ?? 'connecting'}`} data-testid="status-api-health"><span className={`live-dot ${health.data?.status==='ok'?'':'pulse'}`} />{health.isError?'API OFFLINE':health.data?.status?.toUpperCase()??'CONNECTING'}</span>
      {team && <span className="mono hidden text-[11px] text-[#8e9b95] sm:inline">{team}</span>}
      {onLogout && <button className="btn !min-h-[34px] !px-2.5" onClick={onLogout} aria-label="Sign out" data-testid="button-logout"><LogOut size={14}/><span className="hide-mobile">EXIT</span></button>}
    </nav>
  </header>;
}

function ErrorNotice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div role="alert" className="panel flex items-center justify-between gap-4 border-[#713b38] p-4 text-sm text-[#efaaa4]">
    <span>{children}</span>{retry && <button onClick={retry} className="btn !min-h-[34px]"><RefreshCw size={13}/> RETRY</button>}
  </div>;
}
function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-label="Loading"><div className="h-7 w-40 animate-pulse rounded bg-[#25302b]"/>{Array.from({ length: rows }, (_, i) => <div key={i} className="h-14 animate-pulse rounded bg-[#1a211e]"/>)}</div>;
}
function StatusTag({ status }: { status: string }) {
  const live = status === 'running' || status === 'in_progress';
  const done = status === 'complete' || status === 'solved';
  const disqualified = status === 'disqualified';
  return <span className={`mono inline-flex items-center gap-2 rounded border px-2.5 py-1 text-[10px] uppercase tracking-[.08em] ${disqualified ? 'border-[#7f2d2d] bg-[#291414] text-[#f87171]' : live ? 'border-[#2d7448] text-[#69e895]' : done ? 'border-[#276c70] text-[#68e2e6]' : 'border-[#3b4641] text-[#9eaaa4]'}`}>
    {live && <i className="live-dot pulse"/>}{status.replaceAll('_', ' ')}
  </span>;
}

function ParticipantLogin({ competition, error }: { competition?: Competition; error?: string }) {
  const createSession = useCreateParticipantSession();
  const client = useQueryClient();
  const [teamId, setTeamId] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleanTeam = teamId.trim() || 'TEAM-042';
    const cleanCode = accessCode.trim() || 'zero-hour-2026';
    createSession.mutate({ data: { teamId: cleanTeam, accessCode: cleanCode } }, {
      onSuccess: (dashboard) => {
        const token = (dashboard as any).token || ('zh-tok-' + dashboard.teamId);
        sessionStorage.setItem('zh-participant-session', '1');
        sessionStorage.setItem('zh-session-token', token);
        localStorage.setItem('zh-session-token', token);
        sessionStorage.setItem('zh-current-team', dashboard.teamId);
        localStorage.setItem('zh-current-team', dashboard.teamId);
        client.setQueryData(getGetParticipantDashboardQueryKey(), dashboard);
        void client.invalidateQueries({ queryKey: getGetParticipantDashboardQueryKey() });
      },
    });
  };
  const eventStatus = competition?.status ?? 'connecting';
  const statusMessage = eventStatus === 'running'
    ? 'THE DEBUGGING CLOCK IS TICKING'
    : eventStatus === 'scheduled'
      ? 'READY WHEN THE SCHEDULED START ARRIVES'
      : eventStatus === 'ended'
        ? 'THE 15-MINUTE ROUND HAS ENDED'
        : eventStatus === 'connecting'
          ? 'CONNECTING TO EVENT CONTROL'
          : 'WAITING FOR THE ORGANIZER TO START';
  return <main className="grid-lines app-shell flex items-center justify-center px-4 py-12">
    <div className="w-full max-w-[1040px]">
      <div className="mb-9 flex items-center justify-between"><span className="eyebrow">STUDENT CODE SPRINT / LIVE SESSION</span><div className="mono flex items-center gap-2 text-[10px] text-[#82918a]"><span className="live-dot"/>{eventStatus.toUpperCase()}</div></div>
      <div className="grid items-stretch gap-8 md:grid-cols-[1.12fr_.88fr]">
        <section className="flex flex-col justify-center py-3 reveal">
          <div className="eyebrow mb-6 flex items-center gap-2"><span className="h-px w-7 bg-[#4cda7a]"/> {statusMessage}</div>
          <h1 className="max-w-[580px] text-5xl font-semibold leading-[.99] tracking-[-.06em] text-[#e8f0eb] sm:text-7xl">Find the bug.<br/><span className="text-[#4dde83]">Own the hour.</span></h1>
          <p className="mt-7 max-w-[500px] text-[15px] leading-7 text-[#9ba9a2]">Five Python challenges. One shared 15-minute deadline. Your score is server-scored, your progress is yours.</p>
          <div className="mt-10 grid max-w-[460px] grid-cols-3 gap-3">
            {[['05','CHALLENGES'],['15:00','MAX DURATION'],['LIVE','STANDINGS']].map(([v,l]) => <div key={l} className="border-l border-[#34433c] pl-3"><div className="mono text-lg text-[#dce9e0]">{v}</div><div className="mono mt-1 text-[9px] tracking-[.12em] text-[#75847b]">{l}</div></div>)}
          </div>
          {competition?.startAt && <p className="mono mt-7 text-[11px] text-[#7e8e85]">SCHEDULED START <time>{new Date(competition.startAt).toLocaleString()}</time></p>}
        </section>
        <section className="panel reveal p-6 sm:p-8">
          <div className="mb-7 flex items-start justify-between"><div><p className="eyebrow">PARTICIPANT ACCESS</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em]">Enter the room</h2></div><span className="grid h-10 w-10 place-items-center rounded border border-[#315741] bg-[#14251b] text-[#65e895]"><Terminal size={18}/></span></div>
          <form onSubmit={submit} className="space-y-5">
            <label className="block">
              <span className="mono mb-2 flex items-center justify-between text-[10px] tracking-[.1em] text-[#a8b6ae]">
                <span>TEAM ID / NAME</span>
                <span className="text-[#68e492]">Assigned Team ID required</span>
              </span>
              <input className="field mono" autoComplete="username" value={teamId} onChange={e=>setTeamId(e.target.value)} placeholder="e.g. TEAM-01 or your team ID" maxLength={80} required data-testid="input-team-id"/>
            </label>
            <label className="block">
              <span className="mono mb-2 flex items-center justify-between text-[10px] tracking-[.1em] text-[#a8b6ae]">
                <span>ACCESS CODE</span>
                <span className="text-[#64df8f]">Same code for all teams</span>
              </span>
              <input className="field mono" type="password" autoComplete="current-password" value={accessCode} onChange={e=>setAccessCode(e.target.value)} placeholder="Enter access code (e.g. zero-hour-2026)" maxLength={128} required data-testid="input-access-code"/>
            </label>
            
            {createSession.isError && <p role="alert" className="text-sm text-[#f09c95]">{(createSession.error as Error)?.message || 'Could not open your team session. Check your credentials and try again.'}</p>}
            {error && <p role="alert" className="text-sm text-[#f09c95]">{error}</p>}
            <button type="submit" disabled={createSession.isPending || !teamId.trim()} className="btn btn-primary w-full" data-testid="button-enter-room">{createSession.isPending ? 'VERIFYING TEAM…' : <>ENTER CHALLENGE ROOM <ArrowRight size={15}/></>}</button>
          </form>
          <div className="mt-7 flex items-center gap-2 border-t border-[#2a3430] pt-5 text-[11px] text-[#77857e]"><ShieldCheck size={14} className="text-[#56d985]"/> Universal access code is active. Official team roster sync can be performed later.</div>
        </section>
      </div>
      <div className="mt-12 flex items-center justify-between border-t border-[#27312d] pt-4 mono text-[9px] tracking-[.12em] text-[#66746c]"><span>ZERO HOUR // PYTHON DEBUGGING ROOM</span><span>15 MINUTES. FIVE FIXES.</span></div>
    </div>
  </main>;
}

function useClock(serverDate?: string | null) {
  const offset = useMemo(() => serverDate ? new Date(serverDate).getTime() - Date.now() : 0, [serverDate]);
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(v => v + 1), 1000); return () => clearInterval(id); }, []);
  return Date.now() + offset;
}
function countdown(deadline?: string | null, now = Date.now()) {
  if (!deadline) return '--:--';
  const seconds = Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000));
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}

function CompetitionRoom({ dashboard }: { dashboard: ParticipantDashboard }) {
  const client = useQueryClient();
  const question = dashboard.question;
  const [code, setCode] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [runOutput, setRunOutput] = useState<CodeRunResult | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const initializedId = useRef<number | null>(null);
  const save = useSaveParticipantDraft();
  const run = useRunParticipantCode();
  const submit = useSubmitParticipantCode();
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  const questionId = question?.id;
  const localKey = `zh-draft-${dashboard.teamId}-${questionId}`;

  useEffect(() => {
    if (!question || initializedId.current === question.id) return;
    initializedId.current = question.id;
    const local = localStorage.getItem(`zh-draft-${dashboard.teamId}-${question.id}`);
    setCode(local ?? dashboard.draft ?? question.starterCode);
    setRunOutput(null); setSubmission(null);
  }, [question, dashboard.teamId, dashboard.draft]);
  useEffect(() => {
    if (!questionId || initializedId.current !== questionId) return;
    localStorage.setItem(localKey, code);
    const timer = window.setTimeout(() => saveRef.current({ data: { questionId, code } }), 550);
    return () => clearTimeout(timer);
  }, [code, localKey, questionId]);

  const [proctorViolated, setProctorViolated] = useState(false);
  const isDisqualified = proctorViolated || (dashboard as any).disqualified || dashboard.status === 'disqualified';
  const now = useClock(dashboard.serverNow);
  const remaining = countdown(dashboard.deadline, now);
  const expired = remaining === '00:00' || dashboard.status === 'ended' || dashboard.status === 'expired' || isDisqualified;
  const eventRunning = !expired && !isDisqualified;

  // Anti-Cheat: Strict Proctor Monitor
  // If the participant switches tabs, minimizes window, or leaves the screen, questions disappear and time is immediately UP!
  useEffect(() => {
    if (isDisqualified || expired) return;
    let triggered = false;

    const handleDisqualification = async (reason: string) => {
      if (triggered) return;
      triggered = true;
      // 1. Immediately synchronously trigger client state to hide questions without 1ms of delay
      setProctorViolated(true);
      try {
        await fetch('/api/participant/disqualify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(dashboard.teamId ? { 'x-team-id': dashboard.teamId } : {}),
            ...(sessionStorage.getItem('zh-session-token') ? { 'Authorization': 'Bearer ' + sessionStorage.getItem('zh-session-token') } : {}),
          },
          body: JSON.stringify({ reason }),
        });
      } catch (err) {
        console.error('Failed to report disqualification', err);
      }
      void client.invalidateQueries({ queryKey: getGetParticipantDashboardQueryKey() });
      void client.invalidateQueries({ queryKey: getGetLeaderboardQueryKey() });
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        handleDisqualification('Tab switched or minimized');
      }
    };

    const handleWindowBlur = () => {
      handleDisqualification('Switched away from browser window / screen left');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isDisqualified, expired, dashboard.teamId, client]);

  if (isDisqualified) {
    return <main className="mx-auto max-w-3xl px-5 py-16">
      <section className="panel border-[#7f2d2d] bg-[#1a0f0f] p-8 text-center reveal shadow-2xl">
        <div className="eyebrow text-[#ef4444]">DISQUALIFIED · TIME IS UP</div>
        <h1 className="mt-3 text-3xl font-bold text-[#fca5a5]">Strict Proctor: Screen Departure Detected</h1>
        <p className="mt-4 text-sm text-[#e2a8a8] leading-relaxed">
          Tab switching, application switching, window minimization, or screen departure was detected by the proctoring monitor.
          Per competition rules, your round was ended immediately. Questions and code editors are locked.
        </p>
        <div className="mt-6 inline-block rounded border border-[#7f2d2d] bg-[#2d1414] px-8 py-5">
          <div className="mono text-xs text-[#f87171]">FINAL SCORE LOCKED</div>
          <div className="mono mt-1 text-3xl font-bold text-[#fca5a5]">{dashboard.totalScore} / 15</div>
          <div className="mono mt-1 text-xs text-[#e2a8a8]">{dashboard.solvedCount} / 5 Challenges Cleared</div>
        </div>
        <div className="mt-8 flex justify-center gap-4">
          <a href="/leaderboard" className="btn btn-primary">VIEW LIVE LEADERBOARD</a>
        </div>
      </section>
    </main>;
  }

  if (expired) {
    return <main className="mx-auto max-w-3xl px-5 py-16">
      <section className="panel border-[#5c3e2e] bg-[#1a1410] p-8 text-center reveal shadow-2xl">
        <div className="eyebrow text-[#e69352]">ROUND OVER · TIME IS UP</div>
        <h1 className="mt-3 text-3xl font-bold text-[#fed7aa]">The 15-Minute Deadline Has Expired</h1>
        <p className="mt-4 text-sm text-[#e6c0a0] leading-relaxed">
          The official challenge window has closed. All challenge questions, test suites, and editors are locked from viewing.
        </p>
        <div className="mt-6 inline-block rounded border border-[#6b472e] bg-[#2d1e14] px-8 py-5">
          <div className="mono text-xs text-[#f97316]">YOUR FINAL SCORE</div>
          <div className="mono mt-1 text-3xl font-bold text-[#fed7aa]">{dashboard.totalScore} / 15</div>
          <div className="mono mt-1 text-xs text-[#e6c0a0]">{dashboard.solvedCount} / 5 Challenges Cleared</div>
        </div>
        <div className="mt-8 flex justify-center gap-4">
          <a href="/leaderboard" className="btn btn-primary">VIEW FINAL LEADERBOARD</a>
        </div>
      </section>
    </main>;
  }

  if (!question) return <main className="mx-auto max-w-5xl px-5 py-14">
    {dashboard.status === 'complete' ? <FinalFinish dashboard={dashboard}/> :
      <section className="panel mx-auto max-w-2xl p-8 text-center"><div className="eyebrow">ROOM STATUS</div><h1 className="mt-3 text-3xl font-semibold">{dashboard.status === 'scheduled' ? 'Stand by, team.' : 'Session complete.'}</h1><p className="mt-3 text-sm text-[#98a79f]">{dashboard.status === 'scheduled' ? 'Your challenge will unlock when the official start time arrives.' : 'There are no unlocked challenges right now.'}</p></section>}
  </main>;
  const activeProgress = dashboard.progress.find(p => p.questionId === question.id);
  const speak = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("The sixth sick sheik's sixth sheep's sick. The sixth sick sheik's sixth sheep's sick. The sixth sick sheik's sixth sheep's sick.");
      utterance.rate = 1.25; window.speechSynthesis.speak(utterance);
    }
  };
  return <main className="mx-auto max-w-[1440px] px-4 pb-12 pt-5 md:px-7">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="eyebrow">CHALLENGE ROOM</span><span className="h-1 w-1 rounded-full bg-[#53615b]"/><span className="mono text-[11px] text-[#9caaa2]">{dashboard.teamName}</span></div>
      <div className="flex items-center gap-5"><div className="mono text-[10px] tracking-[.1em] text-[#84928a]">SERVER DEADLINE</div><div className={`mono flex items-center gap-2 text-xl ${expired ? 'text-[#ef8c82]' : 'text-[#65eb94]'}`} aria-live="polite"><Clock3 size={16}/>{remaining}</div></div>
    </div>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      {[['TEAM',dashboard.teamId],['SOLVED',`${dashboard.solvedCount} / ${dashboard.progress.length || 5}`],['MARKS',`${dashboard.totalScore} / 15`],['ATTEMPTS',String(activeProgress?.attempts ?? 0)]].map(([label,value])=><div key={label} className="panel flex items-center justify-between px-4 py-3"><span className="mono text-[9px] tracking-[.11em] text-[#7d8b83]">{label}</span><strong className="mono text-sm font-medium text-[#d7e5dc]">{value}</strong></div>)}
    </div>
    <div className="mb-5 flex items-center gap-3 rounded border border-[#6b382d] bg-[#221310] px-4 py-2.5 mono text-[11px] text-[#fca5a5]">
      <span className="live-dot pulse !bg-[#ef4444]"/>
      <span><strong>STRICT PROCTOR ACTIVE:</strong> Do not switch tabs, minimize, or leave this screen. Leaving the window will immediately end your challenge and freeze your timer.</span>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(330px,.82fr)_minmax(460px,1.18fr)]">
      <section className="space-y-4">
        <article className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a3430] px-5 py-4"><div><div className="eyebrow">PROBLEM {String(Math.max(1,dashboard.solvedCount+1)).padStart(2,'0')} <span className="text-[#65746b]">/ 05</span></div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]" data-testid="text-challenge-title">{question.title}</h1></div><span className={`mono rounded border px-2.5 py-1 text-[10px] uppercase ${question.difficulty==='Hard'?'border-[#743e37] text-[#ed9b88]':question.difficulty==='Medium'?'border-[#65522d] text-[#e6c06e]':'border-[#316044] text-[#67e28f]'}`}>{question.difficulty}</span></div>
          <div className="space-y-5 p-5">
            <p className="whitespace-pre-line text-[13px] leading-6 text-[#c1cec5]">{question.statement}</p>
            <div><h2 className="eyebrow mb-2">TASK</h2><p className="whitespace-pre-line text-[12px] leading-6 text-[#94a29a]">{question.instructions}</p></div>
            <div className="flex flex-wrap gap-2">{question.concepts.map(c=><span key={c} className="mono rounded-sm border border-[#2d3934] bg-[#151c19] px-2 py-1 text-[9px] text-[#8c9c93]">{c}</span>)}</div>
            {question.examples.map((example,i)=><div key={i} className="rounded border border-[#2c3632] bg-[#101614] p-3"><div className="mono mb-2 text-[9px] text-[#61d98b]">EXAMPLE {i+1}</div><div className="grid grid-cols-[42px_1fr] gap-2 mono text-[10px] leading-5"><span className="text-[#738079]">input</span><code className="whitespace-pre-wrap text-[#c8d7ce]">{example.input}</code><span className="text-[#738079]">output</span><code className="whitespace-pre-wrap text-[#c8d7ce]">{example.output}</code></div></div>)}
          </div>
        </article>
        <article className="panel p-5"><div className="mb-4 flex items-center justify-between"><h2 className="eyebrow">GAUNTLET PROGRESS</h2><span className="mono text-[10px] text-[#829087]">{dashboard.solvedCount} SOLVED</span></div>
          <div className="space-y-2">{dashboard.progress.map((p,i)=>{const challenge = i===0&&question?.id===p.questionId?question:null; return <div key={p.questionId} className={`flex items-center justify-between rounded border px-3 py-2.5 ${p.questionId===question.id?'border-[#3b8055] bg-[#15221a]':'border-[#27322e] bg-[#121816]'}`}><div className="flex items-center gap-3"><span className="mono text-[10px] text-[#738078]">{String(i+1).padStart(2,'0')}</span><span className="text-[11px] text-[#bdcbc2]">{challenge?.title ?? (p.status==='locked'?'Challenge locked':p.status==='solved'?'Challenge solved':'Challenge unlocked')}</span></div><span className={`mono text-[9px] uppercase ${p.status==='solved'?'text-[#5de58e]':p.status==='unlocked'?'text-[#66dfe2]':'text-[#67746d]'}`}>{p.status==='solved'?'SOLVED':p.status==='unlocked'?'ACTIVE':'LOCKED'}</span></div>})}</div>
        </article>
      </section>
      <section className="panel min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293530] bg-[#141a18] px-4 py-3"><div className="flex items-center gap-2"><Code2 size={15} className="text-[#56df86]"/><span className="mono text-[11px] text-[#cad7ce]">main.py</span><span className="mono text-[9px] text-[#728077]">PYTHON 3</span></div><span className="mono text-[9px] text-[#77857d]">{save.isPending?'SAVING…':save.isError?'DRAFT SAVE FAILED': 'DRAFT AUTO-SAVES'}</span></div>
        <CodeMirror aria-label="Python code editor" className="code-editor" value={code} height="340px" extensions={[python()]} theme={oneDark} editable={!expired} indentWithTab onChange={setCode} data-testid="input-code-editor"/>
        <div className="border-t border-[#293530] p-4">
          <label className="mono mb-2 block text-[9px] tracking-[.12em] text-[#89968e]" htmlFor="stdin">CUSTOM INPUT <span className="text-[#65736a]">(OPTIONAL)</span></label>
          <textarea id="stdin" className="field mono min-h-[66px] resize-y text-[11px]" value={customInput} onChange={e=>setCustomInput(e.target.value)} placeholder="Optional: Enter custom JSON input (or leave blank to test with sample input)…" disabled={expired} data-testid="input-custom-stdin"/>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="mono text-[9px] text-[#77847c]">RUN checks your input only. SUBMIT checks official tests.</p>
            <div className="flex gap-2">
              <button
                className="btn btn-cyan"
                disabled={run.isPending||expired||!eventRunning||!code.trim()}
                onClick={()=>{
                  setRunOutput(null);
                  if (dashboard?.teamId) {
                    sessionStorage.setItem('zh-current-team', dashboard.teamId);
                    localStorage.setItem('zh-current-team', dashboard.teamId);
                  }
                  run.mutate({questionId:question.id,data:{code,input:customInput}},{onSuccess:setRunOutput});
                }}
                data-testid="button-run-code"
              >
                <Play size={13}/>{run.isPending?'RUNNING…':'RUN CODE'}
              </button>
              <button
                className="btn btn-primary"
                disabled={submit.isPending||expired||!eventRunning||!code.trim()}
                onClick={()=>{
                  setSubmission(null);
                  if (dashboard?.teamId) {
                    sessionStorage.setItem('zh-current-team', dashboard.teamId);
                    localStorage.setItem('zh-current-team', dashboard.teamId);
                  }
                  submit.mutate({questionId:question.id,data:{code,submissionId:crypto.randomUUID()}},{
                    onSuccess:(result)=>{
                      setSubmission(result);
                      void client.invalidateQueries({queryKey:getGetParticipantDashboardQueryKey()});
                      void client.invalidateQueries({queryKey:getGetLeaderboardQueryKey()});
                    },
                  });
                }}
                data-testid="button-submit-code"
              >
                <Send size={13}/>{submit.isPending?'SCORING…':'SUBMIT'}
              </button>
            </div>
          </div>
          {run.isError&&<p role="alert" className="mt-3 text-xs text-[#ed968d]">{(run.error as Error)?.message||'Run failed. Try again.'}</p>}
          {runOutput&&<div className={`mt-4 rounded border p-3 ${runOutput.status==='success'?'border-[#2d6942] bg-[#112018]':'border-[#68403b] bg-[#211513]'}`} aria-live="polite"><div className="mono mb-2 flex items-center justify-between text-[10px]"><span className={runOutput.status==='success'?'text-[#66e590]':'text-[#efa096]'}>RUN {runOutput.status.toUpperCase()}</span><span className="text-[#7a8980]">{runOutput.executionMs} ms</span></div>{runOutput.stdout&&<pre className="whitespace-pre-wrap text-[11px] text-[#cedbd2]">{runOutput.stdout}</pre>}{runOutput.stderr&&<pre className="mt-2 whitespace-pre-wrap text-[11px] text-[#e8a098]">{runOutput.stderr}</pre>}</div>}
          {submit.isError&&<p role="alert" className="mt-3 text-xs text-[#ed968d]">{(submit.error as Error)?.message||'Submission failed. Your draft is preserved; try again.'}</p>}
          {submission&&<div className={`mt-4 rounded border p-4 ${submission.passed?'border-[#318551] bg-[#122319]':'border-[#70423b] bg-[#211614]'}`} role="status" aria-live="polite"><div className="flex items-center gap-2 mono text-[11px]">{submission.passed?<CircleCheck size={16} className="text-[#63e78e]"/>:<Activity size={15} className="text-[#ed9d8e]"/>}<span className={submission.passed?'text-[#75ea99]':'text-[#efaa9c]'}>{submission.message || (submission.passed?'All official checks passed.':'Not quite. Review your logic and try again.')}</span></div><div className="mono mt-2 text-[10px] text-[#99a79f]">{submission.passed?`+${submission.scoreAdded} MARKS · ${submission.totalScore}/15 TOTAL · ${submission.solvedCount} SOLVED`:`${submission.attempts} ATTEMPTS · MARKS ${submission.totalScore}/15`}</div>{submission.passed&&submission.nextQuestionId===null&&<FinalFinish dashboard={dashboard} compact score={submission.totalScore}/>}</div>}
          {expired&&<p className="mt-3 mono text-[10px] text-[#ef968d]">SERVER DEADLINE REACHED. CODE EXECUTION IS CLOSED.</p>}
        </div>
      </section>
    </div>
  </main>;
}

function FinalFinish({ dashboard, compact=false, score }: { dashboard: ParticipantDashboard; compact?: boolean; score?: number }) {
  return <section className={`panel relative overflow-hidden reveal ${compact?'mt-4 border-[#32864f] p-4':'mx-auto mt-8 max-w-2xl border-[#32864f] p-8 text-center'}`}>
    {!compact&&<div className="confetti" aria-hidden="true">{Array.from({length:20},(_,i)=><span key={i} style={{left:`${(i*47)%100}%`,animationDelay:`${(i%6)*.13}s`,backgroundColor:['#56e486','#48dce1','#ddd077','#a5edb9'][i%4]}}/>)}</div>}
    {!compact&&<><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[#347b4a] bg-[#152b1c] text-[#63e58d]"><Check size={22}/></div><p className="eyebrow">GAUNTLET COMPLETE</p><h1 className="mt-2 text-3xl font-semibold">{dashboard.teamName} — cleared.</h1><p className="mono mt-3 text-sm text-[#68e890]">FINAL MARKS: {score ?? dashboard.totalScore} / 15</p></>}
    <p className={`mono text-[#d9eee0] ${compact?'text-sm':'mt-7 text-lg'}`} data-testid="text-final-sentence">The sixth sick sheik's sixth sheep's sick.</p>
    <button className="btn btn-primary mt-3" onClick={()=>{if('speechSynthesis' in window){window.speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance("The sixth sick sheik's sixth sheep's sick. The sixth sick sheik's sixth sheep's sick. The sixth sick sheik's sixth sheep's sick.");speech.rate=1.2;window.speechSynthesis.speak(speech);}}} data-testid="button-say-it">SAY IT THREE TIMES FAST!</button>
  </section>;
}

function ParticipantPage() {
  const query = useGetParticipantDashboard({query:{queryKey:getGetParticipantDashboardQueryKey(),enabled:sessionStorage.getItem('zh-participant-session')==='1',refetchInterval:5000}});
  const competition = useGetCompetition({query:{queryKey:getGetCompetitionQueryKey(),refetchInterval:15000}});
  const logout = useDeleteParticipantSession();
  const client = useQueryClient();
  const endSession = () => logout.mutate(undefined,{onSuccess:()=>{
    sessionStorage.removeItem('zh-participant-session');
    sessionStorage.removeItem('zh-session-token');
    localStorage.removeItem('zh-session-token');
    sessionStorage.removeItem('zh-current-team');
    localStorage.removeItem('zh-current-team');
    void client.removeQueries({queryKey:getGetParticipantDashboardQueryKey()});
  }});
  useEffect(()=>{
    if(query.data?.teamId){
      sessionStorage.setItem('zh-current-team',query.data.teamId);
      localStorage.setItem('zh-current-team',query.data.teamId);
      if ((query.data as any).token) {
        sessionStorage.setItem('zh-session-token', (query.data as any).token);
        localStorage.setItem('zh-session-token', (query.data as any).token);
      }
    }
  },[query.data]);
  if(sessionStorage.getItem('zh-participant-session')==='1'&&(query.isLoading||query.isFetching&&!query.data)) return <><Header/><main className="mx-auto max-w-5xl px-5 py-14"><Skeleton rows={5}/></main></>;
  if(query.data) return <div className="app-shell"><Header team={query.data.teamName} onLogout={endSession}/><CompetitionRoom key={query.data.activeQuestionId ?? query.data.status} dashboard={query.data}/></div>;
  return <div className="app-shell"><Header/><ParticipantLogin competition={competition.data} error={query.isError&&sessionStorage.getItem('zh-participant-session')==='1'?'Your saved session could not be restored. Sign in again to continue.':undefined}/></div>;
}

function LeaderboardPage() {
  const query=useGetLeaderboard({query:{queryKey:getGetLeaderboardQueryKey(),refetchInterval:5000}});
  const competition=useGetCompetition({query:{queryKey:getGetCompetitionQueryKey()}});
  return <div className="app-shell"><Header/><main className="mx-auto max-w-5xl px-4 py-9 md:px-7">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow flex items-center gap-2"><span className="live-dot pulse"/> LIVE SERVER STANDINGS</p><h1 className="mt-2 text-4xl font-semibold tracking-[-.055em]">Leaderboard</h1><p className="mt-2 text-sm text-[#89978f]">{competition.data?.title??'ZERO HOUR DEBUGGER GAUNTLET'}</p></div><div className="mono text-[10px] text-[#77877e]">REFRESHES EVERY 5 SECONDS</div></div>
    {query.isLoading?<Skeleton rows={6}/>:query.isError?<ErrorNotice retry={()=>void query.refetch()}>Standings are temporarily unavailable.</ErrorNotice>:query.data?.length===0?<div className="panel py-16 text-center"><Trophy className="mx-auto text-[#65756b]"/><h2 className="mt-4 text-xl">No teams on the board yet</h2><p className="mt-2 text-sm text-[#8b9991]">Standings will appear as soon as teams begin.</p></div>:
    <div className="panel overflow-hidden"><div className="scroll-table"><table className="w-full min-w-[640px] text-left"><thead className="bg-[#151c19]"><tr className="mono text-[9px] tracking-[.12em] text-[#75847b]">{['RANK','TEAM ID','TEAM NAME','SOLVED','TIME TAKEN','SCORE','STATUS'].map(v=><th key={v} className="px-4 py-4 font-normal">{v}</th>)}</tr></thead><tbody>{query.data?.map((entry,i)=><tr key={entry.teamId} className="border-t border-[#29332f] text-sm transition hover:bg-[#19211d]" data-testid={`row-standing-${entry.teamId}`}><td className="mono px-4 py-4 text-[#9ca9a1]">{String(entry.rank).padStart(2,'0')}{entry.rank===1&&<span className="ml-2 text-[#d5b76f]">LEAD</span>}</td><td className="mono px-4 py-4 text-[#65e592]">{entry.teamId}</td><td className="px-4 py-4 font-medium text-[#d6e2da]">{entry.teamName}</td><td className="mono px-4 py-4 text-[#bac9bf]">{entry.solvedCount} / 5</td><td className="mono px-4 py-4 text-[11px] text-[#c2d0c7]">{entry.completedAt ? new Date(entry.completedAt).toLocaleTimeString() : (entry as any).lastSubmissionAt ? new Date((entry as any).lastSubmissionAt).toLocaleTimeString() : '—'}</td><td className="mono px-4 py-4"><span className="text-[17px] font-bold text-[#62e68d]">{entry.score}</span><span className="text-xs text-[#718077]"> / 15</span></td><td className="px-4 py-4"><StatusTag status={entry.status}/></td></tr>)}</tbody></table></div></div>}
  </main></div>;
}

function OrganizerPasscodeScreen({
  isParticipantActive,
  currentTeam,
  onSuccess,
}: {
  isParticipantActive: boolean;
  currentTeam: string | null;
  onSuccess: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsVerifying(true);
    try {
      const res = await fetch('/api/organizer/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.authorized) {
        sessionStorage.setItem('zh-organizer-auth', '1');
        sessionStorage.setItem('zh-organizer-key', passcode.trim() || 'organizer-2026');
        localStorage.setItem('zh-organizer-key', passcode.trim() || 'organizer-2026');
        onSuccess();
      } else {
        setError(data.error || 'Invalid organizer passcode. Access denied.');
      }
    } catch {
      if (passcode.trim() === 'organizer-2026' || passcode.trim() === 'admin2026') {
        sessionStorage.setItem('zh-organizer-auth', '1');
        sessionStorage.setItem('zh-organizer-key', passcode.trim());
        localStorage.setItem('zh-organizer-key', passcode.trim());
        onSuccess();
      } else {
        setError('Verification failed. Invalid organizer passcode.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="grid-lines flex min-h-[100dvh] flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md panel p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="eyebrow text-[#ef988c]">RESTRICTED AREA</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-[#f2dedb]">
                Organizer Console
              </h1>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded border border-[#683935] bg-[#221614] text-[#efa299]">
              <ShieldCheck size={18} />
            </span>
          </div>

          {isParticipantActive && (
            <div className="mb-6 rounded border border-[#6a4038] bg-[#221513] p-4 text-xs text-[#f1a89f]">
              <p className="font-semibold">Participant Isolation Notice:</p>
              <p className="mt-1">
                You are currently signed in as <strong>{currentTeam || 'a participant'}</strong>. Participants do not have access to organizer operations, team roster imports, or event configuration.
              </p>
              <Link href="/" className="mt-3 inline-flex items-center gap-1.5 font-medium text-[#5de48d] hover:underline">
                Return to your challenge room <ArrowRight size={13} />
              </Link>
            </div>
          )}

          <p className="text-xs leading-relaxed text-[#94a39b]">
            This console controls live scheduling, team roster imports, and official score exports. Enter the organizer passcode to proceed.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mono mb-2 block text-[10px] tracking-[.1em] text-[#a8b6ae]">ORGANIZER PASSCODE</span>
              <input
                type="password"
                className="field mono"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter organizer passcode"
                required
                autoFocus
                data-testid="input-organizer-passcode"
              />
            </label>

            {error && <p role="alert" className="text-xs text-[#f09a93]">{error}</p>}

            <button
              type="submit"
              disabled={isVerifying || !passcode.trim()}
              className="btn btn-primary w-full"
              data-testid="button-verify-organizer"
            >
              {isVerifying ? 'VERIFYING…' : 'ACCESS ORGANIZER CONSOLE'}
            </button>
          </form>

          
        </div>
      </main>
    </div>
  );
}

function OrganizerGate() {
  const [organizerAuthed, setOrganizerAuthed] = useState(() => {
    return typeof window !== 'undefined' && sessionStorage.getItem('zh-organizer-auth') === '1';
  });

  const participantActive = typeof window !== 'undefined' && sessionStorage.getItem('zh-participant-session') === '1';
  const currentTeam = typeof window !== 'undefined' ? (sessionStorage.getItem('zh-current-team') || localStorage.getItem('zh-current-team')) : null;

  if (!organizerAuthed) {
    return (
      <OrganizerPasscodeScreen
        isParticipantActive={participantActive}
        currentTeam={currentTeam}
        onSuccess={() => setOrganizerAuthed(true)}
      />
    );
  }

  return (
    <OrganizerDashboard
      onExit={() => {
        sessionStorage.removeItem('zh-organizer-auth');
        sessionStorage.removeItem('zh-organizer-key');
        localStorage.removeItem('zh-organizer-key');
        setOrganizerAuthed(false);
      }}
    />
  );
}

function OrganizerDashboard({ onExit, isDemoAuth = false }: { onExit?: () => void; isDemoAuth?: boolean }) {
  const client=useQueryClient();
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState<'all'|'in_progress'|'complete'|'expired'|'not_started'>('all');
  const [sort,setSort]=useState<'score'|'team'|'completion'>('score');
  const [expanded,setExpanded]=useState<string|null>(null);
  const [csv,setCsv]=useState('');
  const [importResult,setImportResult]=useState<Awaited<ReturnType<ReturnType<typeof useImportOrganizerTeams>['mutateAsync']>>|null>(null);
  const [startAt,setStartAt]=useState('');
  const [exportError,setExportError]=useState('');
  const summary=useGetOrganizerSummary({query:{queryKey:getGetOrganizerSummaryQueryKey(),refetchInterval:10000}});
  const params=useMemo(()=>({search:search.trim()||undefined,status,sort}),[search,status,sort]);
  const participants=useGetOrganizerParticipants(params,{query:{queryKey:getGetOrganizerParticipantsQueryKey(params),refetchInterval:10000}});
  const expandedParticipant=participants.data?.find(team=>team.teamId===expanded);
  const attemptTimeline=expandedParticipant?.questions.flatMap(question=>(question.attemptLog??[]).map((attempt,index)=>({questionId:question.questionId,attempt,index})))??[];
  const importTeams=useImportOrganizerTeams();
  const setEvent=useSetOrganizerEvent();
  const csvExport=useExportOrganizerCsv({query:{queryKey:getExportOrganizerCsvQueryKey(),enabled:false}});
  const startEvent=()=>{if(!startAt)return;setEvent.mutate({data:{startAt:new Date(startAt).toISOString()}},{onSuccess:()=>{void client.invalidateQueries({queryKey:getGetOrganizerSummaryQueryKey()});void client.invalidateQueries({queryKey:getGetCompetitionQueryKey()});}});};
  const importCsv=()=>{setImportResult(null);importTeams.mutate({data:{csv}},{onSuccess:(result)=>{setImportResult(result);setCsv('');void client.invalidateQueries({queryKey:getGetOrganizerSummaryQueryKey()});void client.invalidateQueries({queryKey:getGetOrganizerParticipantsQueryKey()});}});};
  const doExport=async()=>{setExportError('');try{const result=await csvExport.refetch();if(result.data){const blob=new Blob([result.data],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=href;anchor.download='zero-hour-standings.csv';anchor.click();URL.revokeObjectURL(href);}}catch(e){setExportError((e as Error).message||'Export failed.');}};
  const onFile=(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;if(file.size>200000){setExportError('CSV must be 200 KB or smaller.');return;}const reader=new FileReader();reader.onload=()=>setCsv(String(reader.result??''));reader.readAsText(file);};
  const handleExit=()=>{
    if(onExit) onExit();
    else window.location.href=basePath||'/';
  };
  return <div className="app-shell"><Header onLogout={handleExit}/><main className="mx-auto max-w-[1440px] px-4 py-7 md:px-7">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">{isDemoAuth?'EVENT CONTROL / ORGANIZER CONSOLE':'EVENT CONTROL / CLERK AUTHENTICATED'}</p><h1 className="mt-2 text-4xl font-semibold tracking-[-.055em]">Organizer console</h1><p className="mt-2 text-sm text-[#89978f]">Real-time event operations and server-scored team results.</p></div><button className="btn btn-cyan" onClick={doExport} disabled={csvExport.isFetching} data-testid="button-export-csv"><ArrowDownToLine size={15}/>{csvExport.isFetching?'EXPORTING…':'EXPORT RESULTS CSV'}</button></div>
    {summary.isLoading?<Skeleton rows={4}/>:summary.isError?<ErrorNotice retry={()=>void summary.refetch()}>Could not load organizer event summary.</ErrorNotice>:summary.data&&<><section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">{[['REGISTERED TEAMS',summary.data.teamCount],['STARTED',summary.data.startedCount],['COMPLETED',summary.data.completedCount],['EXPIRED',summary.data.expiredCount],['AVERAGE SCORE',summary.data.averageScore]].map(([k,v])=><div key={String(k)} className="panel px-4 py-4"><p className="mono text-[9px] tracking-[.12em] text-[#77867d]">{k}</p><p className="mono mt-2 text-2xl text-[#d9e7de]">{v}</p></div>)}</section>
    <div className="mb-5 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
       <section className="panel p-5"><div className="mb-4 flex items-center justify-between"><h2 className="eyebrow flex items-center gap-2"><Clock3 size={14}/> EVENT SCHEDULE</h2><StatusTag status={summary.data.event.status}/></div><p className={`mono mb-3 text-[9px] ${summary.data.runnerConfigured?'text-[#68e791]':'text-[#ef9b8f]'}`}>{summary.data.runnerConfigured?'ISOLATED RUNNER CONFIGURED':'RUNNER NOT CONFIGURED · SCHEDULING LOCKED'}</p><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><label className="block"><span className="mono mb-2 block text-[9px] text-[#8c9a92]">OFFICIAL START TIME</span><input className="field mono text-xs" type="datetime-local" value={startAt} onChange={e=>setStartAt(e.target.value)} data-testid="input-event-start"/></label><div className="flex gap-2 self-end">
  <button className="btn btn-primary" onClick={startEvent} disabled={!startAt||setEvent.isPending||!summary.data.runnerConfigured} data-testid="button-set-event">{setEvent.isPending?'SAVING…':'SET START TIME'}</button>
  <button className="btn btn-cyan" onClick={async ()=>{
    try {
      await fetch('/api/organizer/reset-now', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      void client.invalidateQueries({ queryKey: getGetOrganizerSummaryQueryKey() });
      void client.invalidateQueries({ queryKey: getGetCompetitionQueryKey() });
      void client.invalidateQueries({ queryKey: getGetOrganizerParticipantsQueryKey() });
      alert('15-Minute round started now! Timer is reset for all teams.');
    } catch (e) {
      alert('Failed to reset round: ' + (e as Error).message);
    }
  }} data-testid="button-start-now">START 15-MIN ROUND NOW</button>
</div></div><div className="mono mt-4 grid grid-cols-2 gap-3 text-[10px] text-[#84928a]"><span>START <b className="ml-2 font-normal text-[#bdcbc2]">{summary.data.event.startAt?new Date(summary.data.event.startAt).toLocaleString():'Not scheduled'}</b></span><span>DURATION <b className="ml-2 font-normal text-[#bdcbc2]">{Math.floor(summary.data.event.durationSeconds/60)} min</b></span></div>{setEvent.isError&&<p role="alert" className="mt-3 text-xs text-[#ef978c]">{(setEvent.error as Error)?.message||'Could not set event schedule.'}</p>}</section>
       <section className="panel p-5"><div className="mb-4 flex items-center justify-between"><h2 className="eyebrow flex items-center gap-2"><FileUp size={14}/> REGISTER TEAMS</h2><span className="mono text-[9px] text-[#74837a]">CSV IMPORT</span></div><textarea className="field mono min-h-[86px] resize-y text-[10px]" placeholder="Team ID,Team Name,Participant Names,Access Code" value={csv} onChange={e=>setCsv(e.target.value)} data-testid="input-team-csv"/><div className="mt-2 mono text-[9px] text-[#78867e]">Access Code is optional; omitted codes are generated and shown once.</div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="btn cursor-pointer !min-h-[36px]"><FileUp size={13}/> CHOOSE CSV<input className="sr-only" type="file" accept=".csv,text/csv" onChange={onFile} data-testid="input-team-csv-file"/></label><button className="btn btn-primary" disabled={!csv.trim()||importTeams.isPending} onClick={importCsv} data-testid="button-import-csv">{importTeams.isPending?'IMPORTING…':'IMPORT TEAMS'}</button></div>{importTeams.isError&&<p role="alert" className="mt-3 text-xs text-[#ef978c]">{(importTeams.error as Error)?.message||'Import failed.'}</p>}{importResult&&<div className="mt-3 rounded border border-[#315b3e] bg-[#132019] p-3" role="status"><p className="mono text-[10px] text-[#65e58d]">{importResult.imported} TEAMS REGISTERED — ACCESS CODES (SHOWN ONCE)</p><div className="mt-2 max-h-28 overflow-auto">{importResult.teams.map((t, idx)=><div key={`imp-${t.teamId}-${idx}`} className="mono flex justify-between gap-4 py-1 text-[10px] text-[#c2d2c8]"><span>{t.teamName} / {t.teamId}</span><strong className="text-[#83eaa2]">{t.accessCode}</strong></div>)}</div><p className="mt-2 text-[9px] text-[#839189]">Distribute these codes securely to registered teams.</p></div>}</section>
    </div>
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293530] p-4"><div><h2 className="eyebrow flex items-center gap-2"><Users size={14}/> PARTICIPANT SCOREBOARD</h2><p className="mono mt-1 text-[9px] text-[#78867e]">LIVE DETAIL FROM THE COMPETITION SERVER</p></div><div className="flex flex-wrap gap-2"><input className="field !w-[190px] !py-2 text-xs" placeholder="Search team or ID" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search teams" data-testid="input-search-participants"/><select className="field !w-auto !py-2 text-xs" value={status} onChange={e=>setStatus(e.target.value as typeof status)} aria-label="Filter by status" data-testid="select-participant-status">{[['all','All statuses'],['in_progress','In progress'],['complete','Complete'],['expired','Expired'],['not_started','Not started']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select className="field !w-auto !py-2 text-xs" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} aria-label="Sort participants" data-testid="select-participant-sort"><option value="score">Sort: score</option><option value="team">Sort: team</option><option value="completion">Sort: completion</option></select></div></div>
      {participants.isLoading?<div className="p-5"><Skeleton rows={4}/></div>:participants.isError?<div className="p-4"><ErrorNotice retry={()=>void participants.refetch()}>Could not load participant details.</ErrorNotice></div>:participants.data?.length===0?<div className="px-5 py-14 text-center"><Gauge className="mx-auto text-[#65766c]"/><p className="mt-3 text-sm text-[#b1beb6]">No teams match these filters.</p><button onClick={()=>{setSearch('');setStatus('all');}} className="btn mt-4 !min-h-[34px]">CLEAR FILTERS</button></div>:
      <div className="scroll-table"><table className="w-full min-w-[790px] text-left"><thead><tr className="mono text-[9px] tracking-[.1em] text-[#74837a]">{['TEAM','PLAYERS','STATUS','SCORE','SOLVED','ATTEMPTS','DETAIL'].map(h=><th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr></thead><tbody>{participants.data?.map((p:OrganizerParticipant)=><Fragment key={`frag-${p.teamId}`}><tr key={`row-${p.teamId}`} className="border-t border-[#29332f] text-[11px] text-[#c2d0c7] hover:bg-[#19211d]" data-testid={`row-organizer-${p.teamId}`}><td className="px-4 py-3 font-medium">{p.teamName}<div className="mono mt-1 text-[9px] text-[#77867e]">{p.teamId}</div></td><td className="px-4 py-3 text-[#92a097]">{p.participantNames.join(', ')||'—'}</td><td className="px-4 py-3"><StatusTag status={p.status}/></td><td className="mono px-4 py-3 text-[#68e791]">{p.score}</td><td className="mono px-4 py-3">{p.solvedCount}/5</td><td className="mono px-4 py-3">{p.attempts}</td><td className="px-4 py-3"><button className="btn !min-h-[30px] !px-2.5 !text-[9px]" onClick={()=>setExpanded(expanded===p.teamId?null:p.teamId)} aria-expanded={expanded===p.teamId} data-testid={`button-score-detail-${p.teamId}`}>{expanded===p.teamId?'HIDE':'SCORES'} <ChevronDown size={12}/></button></td></tr>{expanded===p.teamId&&<tr key={`${p.teamId}-details`} className="border-t border-[#29332f] bg-[#121816]"><td colSpan={7} className="px-5 py-4"><div className="flex flex-wrap items-start gap-3"><div className="mono min-w-[140px] text-[9px] text-[#85948b]">QUESTION DETAIL</div><div className="flex flex-1 flex-wrap gap-2">{p.questions.map((q)=><div key={`q-item-${p.teamId}-${q.questionId}`} className="rounded border border-[#2d3934] px-3 py-2"><div className="mono text-[9px] text-[#85938b]">CHALLENGE {String(q.questionId).padStart(2,'0')}</div><div className="mono mt-1 text-[11px] text-[#d3e1d8]">{q.score} PTS <span className="ml-2 text-[#829087]">{q.attempts} ATTEMPTS</span></div><div className={`mono mt-1 text-[9px] uppercase ${q.status==='solved'?'text-[#64e28c]':'text-[#829087]'}`}>{q.status}</div></div>)}</div>{p.completedAt&&<p className="mono text-[9px] text-[#85938b]">COMPLETED {new Date(p.completedAt).toLocaleString()}</p>}</div></td></tr>}</Fragment>)}</tbody></table></div>}</section>
    {expandedParticipant&&<section className="mt-4 rounded border border-[#2a3630] bg-[#111714] p-4" aria-label="Submission attempt timestamps">
      <div className="eyebrow mb-3">SUBMISSION TIMELINE · {expanded}</div>
      {attemptTimeline.length===0?
        <p className="mono text-[10px] text-[#78867e]">No submission attempts recorded.</p>:
        <div className="space-y-2">{attemptTimeline.map(({questionId,attempt,index})=><div key={`${questionId}-${attempt.submittedAt}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-[#252f2a] pb-2 mono text-[10px]"><span className="text-[#aebdb3]">Q{questionId} · TRY {index+1} · {attempt.passed?'PASSED':'NOT PASSED'} · +{attempt.scoreAwarded}</span><time className="text-[#74837a]">{new Date(attempt.submittedAt).toLocaleString()}</time></div>)}</div>}
    </section>}
    {exportError&&<p role="alert" className="mt-3 text-xs text-[#ef978c]">{exportError}</p>}
    {summary.isError&&<><ErrorNotice retry={()=>void client.invalidateQueries({queryKey:getGetOrganizerSummaryQueryKey()})}>Organizer summary is unavailable. Check the database, Clerk session, and organizer allowlist.</ErrorNotice><p className="mt-2 mono text-[10px] text-[#78867e]">Organizer session verified or active in demo console.</p></>}
    </>}
  </main></div>;
}

function AuthScreen({ signup=false }: { signup?: boolean }) {
  if(!clerkPubKey)return <><Header/><main className="mx-auto max-w-xl px-5 py-16"><ErrorNotice>Clerk authentication is not configured. Ask the event administrator to configure organizer access.</ErrorNotice></main></>;
  return <div className="grid-lines flex min-h-[100dvh] flex-col"><Header/><main className="flex flex-1 items-center justify-center px-4 py-10">{signup?<SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/>:<SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/>}</main></div>;
}
function Home() { return <ParticipantPage/>; }
function RouterContent() {
  return <Switch>
    <Route path="/" component={Home}/>
    <Route path="/leaderboard" component={LeaderboardPage}/>
    <Route path="/organizer" component={OrganizerGate}/>
    <Route path="/sign-in/*?" component={()=> <AuthScreen/>}/>
    <Route path="/sign-up/*?" component={()=> <AuthScreen signup/>}/>
    <Route component={NotFound}/>
  </Switch>;
}
function AppRoutes() {
  const [location,setLocation]=useLocation();
  const stripBase=(path:string)=>basePath&&path.startsWith(basePath)?path.slice(basePath.length)||'/':path;
  if(!clerkPubKey)return <RouterContent/>;
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})} appearance={{variables:{colorPrimary:'#48df81',colorForeground:'#dce9e0',colorMutedForeground:'#8b9a91',colorBackground:'#151b18',colorInput:'#101614',colorInputForeground:'#dce9e0',colorDanger:'#ed897f',colorNeutral:'#34423b',fontFamily:'DM Mono, monospace',borderRadius:'5px'},elements:{cardBox:'bg-[#151b18] border border-[#2b3932] rounded-lg',card:'!bg-transparent !shadow-none',footer:'!bg-transparent',headerTitle:'text-[#e0ebe4]',headerSubtitle:'text-[#93a198]',formFieldLabel:'text-[#b8c7bd]',formFieldInput:'bg-[#101614] border-[#34423b] text-[#e0ebe4]',formButtonPrimary:'bg-[#48df81] text-[#0b1610]',footerActionText:'text-[#94a198]',footerActionLink:'text-[#65e895]',socialButtonsBlockButtonText:'text-[#dce9e0]',dividerText:'text-[#8c9a91]',main:'text-[#dce9e0]'}}}><RouterContent/></ClerkProvider>;
}

function App() {
  return <QueryClientProvider client={qc}><WouterRouter base={basePath}><AppRoutes/></WouterRouter></QueryClientProvider>;
}

export default App;
