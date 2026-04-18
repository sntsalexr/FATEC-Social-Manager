/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { Menu, User, Users, X, Plus, MoreHorizontal, Clock, CheckCircle2, AlertCircle, AlertTriangle, Layout, Calendar, BarChart3, Settings, LogOut, Camera, Eye, EyeOff, Activity, Send, ChevronLeft, ChevronRight, Search, Trash2, Edit2, Link, FileText, ExternalLink, Shield, Check, Layers, Copy, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  verifyBeforeUpdateEmail,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocFromServer,
  writeBatch
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
  AUTH = 'auth',
  CLIENT = 'client',
}

interface FirestoreErrorInfo {
  error: string;
  code?: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null, shouldThrow = true) {
  const errInfo: FirestoreErrorInfo = {
    error: error?.message || String(error),
    code: error?.code,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  const isPermissionError = (errInfo.error.toLowerCase().includes('permission') || 
                             errInfo.error.toLowerCase().includes('insufficient') ||
                             error?.code === 'permission-denied');
  
  if (shouldThrow || isPermissionError) {
    throw new Error(JSON.stringify(errInfo));
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Ocorreu um erro inesperado.";
      let details = "";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) {
          if (parsed.error.toLowerCase().includes('offline')) {
            message = "Erro de Conexão com o Banco de Dados";
            details = "Não foi possível estabelecer uma conexão com o Firebase. Verifique sua chave de API e se o domínio está autorizado.";
          } else {
            message = `Erro no Firestore: ${parsed.error}`;
          }
        }
      } catch (e) {
        message = this.state.error?.message || message;
      }
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#0F0F14] text-white p-10 text-center">
          <Activity size={48} className="text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Ops! Algo deu errado.</h1>
          <p className="text-gray-400 mb-2">{message}</p>
          {details && <p className="text-gray-500 text-sm mb-6 max-w-md">{details}</p>}
          <div className="flex gap-4">
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-[#7C3AED] rounded-xl font-bold hover:scale-105 transition-all"
            >
              Recarregar Aplicativo
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type View = 'login' | 'create' | 'dashboard' | 'forgot-password';
type DashboardTab = 'production' | 'calendar' | 'metrics';

interface UserData {
  uid?: string;
  firstname: string;
  lastname: string;
  email: string;
  password?: string;
  photo: string;
  roles?: string[];
  sectors?: string[];
}

const AVAILABLE_ROLES = ['Administrador', 'Copy & Roteiro', 'Criativo', 'Captação', 'Edição'];

const isUserAdmin = (user: UserData | null) => {
  return user?.roles?.includes('Administrador') || user?.email === 'santosalexander97528@gmail.com';
};

const cleanObject = (obj: any) => {
  const newObj: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      newObj[key] = obj[key];
    }
  });
  return newObj;
};

const formatTime = (isoString: string) => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString; // Fallback for old data
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoString;
  }
};

const checkUserPermission = (user: UserData | null, stepId: number) => {
  if (!user) return false;
  if (isUserAdmin(user)) return true;
  const userRoles = user.roles || [];
  if (stepId === 1 || stepId === 2) return userRoles.includes('Copy & Roteiro');
  if (stepId === 3) return userRoles.includes('Criativo');
  if (stepId === 4) return userRoles.includes('Captação');
  if (stepId === 6) return userRoles.includes('Edição');
  return false;
};

interface AppNotification {
  id: string;
  userId: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'error';
  targetRole?: string;
}

interface ChatMessage {
  id: string;
  userId: string;
  user: string;
  photo: string;
  text: string;
  timestamp: string;
}

interface ProductionContent {
  id: string;
  title: string;
  description: string;
  type?: 'image' | 'video';
  fileLink?: string;
  finalFileLink?: string;
  rawFiles?: string[];
  timestamp: string;
  completionDate?: string; // YYYY-MM-DD
  status: 'todo' | 'doing' | 'done' | 'gravando' | 'editando' | 'finalizado';
  sentToNext?: boolean;
  sourceStepId?: number;
  sourceContentId?: string;
  displayLog?: number; // For Televisão
  readyForCalendar?: boolean;
  assignedUserIds?: string[];
  logs?: {
    action: string;
    user: string;
    timestamp: string;
  }[];
}

interface ProductionStep {
  id: number;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done';
  contents?: ProductionContent[];
  messages?: ChatMessage[];
}

const ACADEMIC_CALENDAR_2026 = [
  // Janeiro
  { date: '2026-01-01', title: 'Confraternização Universal', type: 'holiday' },
  { date: '2026-01-20', title: 'Dia de São Sebastião', type: 'holiday' },
  // Fevereiro
  { date: '2026-02-09', title: 'Início das Aulas', type: 'academic' },
  { date: '2026-02-14', title: 'Carnaval', type: 'recess' },
  { date: '2026-02-15', title: 'Carnaval', type: 'recess' },
  { date: '2026-02-16', title: 'Carnaval', type: 'recess' },
  { date: '2026-02-17', title: 'Carnaval', type: 'holiday' },
  { date: '2026-02-18', title: 'Quarta-feira de Cinzas', type: 'recess' },
  // Abril
  { date: '2026-04-03', title: 'Paixão de Cristo', type: 'holiday' },
  { date: '2026-04-04', title: 'Sábado de Aleluia', type: 'recess' },
  { date: '2026-04-05', title: 'Páscoa', type: 'holiday' },
  { date: '2026-04-20', title: 'Recesso (Tiradentes)', type: 'recess' },
  { date: '2026-04-21', title: 'Tiradentes', type: 'holiday' },
  // Maio
  { date: '2026-05-01', title: 'Dia do Trabalho', type: 'holiday' },
  { date: '2026-05-02', title: 'Recesso (Dia do Trabalho)', type: 'recess' },
  // Junho
  { date: '2026-06-04', title: 'Corpus Christi', type: 'holiday' },
  { date: '2026-06-05', title: 'Recesso (Corpus Christi)', type: 'recess' },
  { date: '2026-06-06', title: 'Recesso (Corpus Christi)', type: 'recess' },
  { date: '2026-06-27', title: 'Término das Aulas', type: 'academic' },
  // Julho
  { date: '2026-07-04', title: 'Encerramento do 1º Semestre', type: 'academic' },
  { date: '2026-07-09', title: 'Revolução Constitucionalista', type: 'holiday' },
  { date: '2026-07-10', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-11', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-12', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-13', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-14', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-15', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-16', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-17', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-18', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-19', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-20', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-21', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-22', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-23', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-24', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-25', title: 'Recesso Escolar', type: 'recess' },
  { date: '2026-07-27', title: 'Início do 2º Semestre', type: 'academic' },
  // Agosto
  { date: '2026-08-03', title: 'Início das Aulas', type: 'academic' },
  // Setembro
  { date: '2026-09-07', title: 'Independência do Brasil', type: 'holiday' },
  { date: '2026-09-14', title: 'Aniversário de Pres. Prudente', type: 'holiday' },
  // Outubro
  { date: '2026-10-12', title: 'Nossa Senhora Aparecida', type: 'holiday' },
  { date: '2026-10-15', title: 'Dia do Professor', type: 'holiday' },
  // Novembro
  { date: '2026-11-02', title: 'Dia de Finados', type: 'holiday' },
  { date: '2026-11-15', title: 'Proclamação da República', type: 'holiday' },
  { date: '2026-11-20', title: 'Dia da Consciência Negra', type: 'holiday' },
  { date: '2026-11-21', title: 'Recesso (Consciência Negra)', type: 'recess' },
  // Dezembro
  { date: '2026-12-08', title: 'Feriado Religioso', type: 'holiday' },
  { date: '2026-12-14', title: 'Término das Aulas', type: 'academic' },
  { date: '2026-12-21', title: 'Encerramento do 2º Semestre', type: 'academic' },
  { date: '2026-12-25', title: 'Natal', type: 'holiday' },
];

interface ScheduledTask {
  id: string;
  stepId: number;
  contentId?: string;
  contentTitle?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  description: string;
  status?: 'Agendado' | 'Publicado';
  type?: 'arte' | 'vídeo' | 'outro';
  finalFileLink?: string;
  originStepId?: number;
  taskReferenceId?: string;
  logs?: {
    action: string;
    user: string;
    timestamp: string;
  }[];
}

interface ProductionCardProps {
  step: ProductionStep;
  onSendMessage: (id: number, text: string) => void;
  onRemoveMessage: (stepId: number, messageId: string) => void;
  onAddContent: (id: number, content: Omit<ProductionContent, 'id' | 'timestamp' | 'status'>) => void;
  onUpdateContent: (stepId: number, contentId: string, updates: Partial<ProductionContent>) => void;
  onRemoveContent: (stepId: number, contentId: string) => void;
  onUpdateContentStatus: (stepId: number, contentId: string, status: string) => void;
  onSendToCalendar?: (content: ProductionContent) => void;
  onLogDisplay?: (contentId: string) => void;
  allContents: Record<number, ProductionContent[]>;
  currentUser: UserData;
  allUsers: UserData[];
  isFocused: boolean;
  onFocus: (id: number) => void;
}

const ProductionCard = React.memo<ProductionCardProps>(({ step, onSendMessage, onRemoveMessage, onAddContent, onUpdateContent, onRemoveContent, onUpdateContentStatus, onSendToCalendar, onLogDisplay, allContents, currentUser, allUsers, isFocused, onFocus }) => {
  const [msg, setMsg] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'chat' | 'contents'>('contents');
  const [isAddingContent, setIsAddingContent] = React.useState(false);
  const [editingContentId, setEditingContentId] = React.useState<string | null>(null);
  const [expandedContentId, setExpandedContentId] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [newContentTitle, setNewContentTitle] = React.useState('');
  const [newContentDescription, setNewContentDescription] = React.useState('');
  const [newContentFileLink, setNewContentFileLink] = React.useState('');
  const [newContentAssignedUserIds, setNewContentAssignedUserIds] = React.useState<string[]>([]);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const contents = allContents[step.id] || [];
  const cardRef = React.useRef<HTMLDivElement>(null);
  const chatRef = React.useRef<HTMLDivElement>(null);

  const prevMessagesLength = React.useRef(0);
  const isFirstLoad = React.useRef(true);
  const lastTab = React.useRef(activeTab);
  const isCurrentUserAdmin = isUserAdmin(currentUser);
  const isCopyRoteiro = currentUser?.roles?.includes('Copy & Roteiro');

  const canCreateContent = React.useMemo(() => {
    // Only Copy (1) and Roteiro (2) can create new items manually.
    // Stage IDs: 3 (Criativo), 4 (Captação), 6 (Edição) receive content from previous stages.
    if ([3, 4, 6].includes(step.id)) return false;
    
    if (isCurrentUserAdmin) return true;
    return isCopyRoteiro;
  }, [isCurrentUserAdmin, isCopyRoteiro, step.id]);

  const canEditStep = React.useMemo(() => {
    if (isCurrentUserAdmin) return true;
    const userRoles = currentUser?.roles || [];
    if (step.id === 1) return userRoles.includes('Copy & Roteiro');
    if (step.id === 2) return userRoles.includes('Copy & Roteiro');
    if (step.id === 3) return userRoles.includes('Criativo');
    if (step.id === 4) return userRoles.includes('Captação');
    if (step.id === 6) return userRoles.includes('Edição');
    return false;
  }, [step.id, currentUser, isCurrentUserAdmin]);

  const getSourceContent = (content: ProductionContent) => {
    if (!content.sourceStepId || !content.sourceContentId) return null;
    return (allContents[content.sourceStepId] || []).find(c => c.id === content.sourceContentId);
  };

  React.useEffect(() => {
    // Real-time messages listener
    const unsubMessages = onSnapshot(
      query(collection(db, `productionSteps/${step.id}/messages`), orderBy('timestamp', 'asc')),
      (snapshot) => {
        setMessages(snapshot.docs.map(d => d.data() as ChatMessage));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `productionSteps/${step.id}/messages`)
    );

    return () => {
      unsubMessages();
    };
  }, [step.id]);

  React.useEffect(() => {
    if (messages.length > 0 && isFirstLoad.current) {
      prevMessagesLength.current = messages.length;
      isFirstLoad.current = false;
      return;
    }

    if (activeTab === 'chat') {
      setUnreadCount(0);
    } else if (messages.length > prevMessagesLength.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.userId !== auth.currentUser?.uid) {
        setUnreadCount(prev => prev + (messages.length - prevMessagesLength.current));
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, activeTab]);

  React.useEffect(() => {
    if (chatRef.current) {
      const behavior = lastTab.current === activeTab ? 'smooth' : 'auto';
      const container = chatRef.current;
      
      // Use a small timeout to ensure the DOM has updated and animations are starting
      const timeoutId = setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior
        });
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
    lastTab.current = activeTab;
  }, [messages, activeTab]);

  const handleSend = () => {
    if (msg.trim()) {
      onSendMessage(step.id, msg);
      setMsg('');
    }
  };

  const handleAddContent = () => {
    const isRoteiro = step.id === 2;
    const isValid = newContentTitle.trim() && (isRoteiro || newContentDescription.trim());

    if (isValid) {
      if (editingContentId) {
        onUpdateContent(step.id, editingContentId, {
          title: newContentTitle,
          description: isRoteiro ? '' : newContentDescription,
          fileLink: newContentFileLink,
          assignedUserIds: newContentAssignedUserIds
        });
      } else {
        onAddContent(step.id, {
          title: newContentTitle,
          description: isRoteiro ? '' : newContentDescription,
          fileLink: newContentFileLink,
          assignedUserIds: newContentAssignedUserIds
        });
      }
      setNewContentTitle('');
      setNewContentDescription('');
      setNewContentFileLink('');
      setNewContentAssignedUserIds([]);
      setIsAddingContent(false);
      setEditingContentId(null);
    }
  };

  const handleEditContent = (content: ProductionContent) => {
    setNewContentTitle(content.title);
    setNewContentDescription(content.description);
    setNewContentFileLink(content.fileLink || '');
    setNewContentAssignedUserIds(content.assignedUserIds || []);
    setEditingContentId(content.id);
    setIsAddingContent(true);
  };

  const getStatusOptions = (stepId: number) => {
    if (stepId === 4) return ['todo', 'gravando', 'editando', 'finalizado'];
    return ['todo', 'doing', 'done'];
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'todo': return 'Pendente';
      case 'doing': return 'Progresso';
      case 'done': return 'Concluído';
      case 'gravando': return 'Gravando';
      case 'editando': return 'Editando';
      case 'finalizado': return 'Finalizado';
      default: return status;
    }
  };

  return (
    <motion.div 
      ref={cardRef}
      onClick={(e) => {
        e.stopPropagation();
        onFocus(step.id);
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col h-[520px] bg-[#181820] rounded-[24px] border transition-all duration-500 overflow-hidden cursor-pointer ${ isFocused ? 'border-[#7C3AED] shadow-[0_0_40px_rgba(124,58,237,0.25)] ring-1 ring-[#7C3AED]/50 opacity-100' : step.status === 'done' ? 'border-green-500/30 shadow-[0_0_30px_rgba(16,185,129,0.15)] opacity-95' : 'border-white/5 opacity-60'}`}
    >
      <div className="p-5 bg-gradient-to-b from-white/[0.02] to-transparent border-b border-white/5">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="font-bold text-lg text-white/90">{step.title}</h3>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 mb-1">
              {contents.length > 0 && (
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${step.status === 'done' ? 'bg-green-500/20 text-green-500' : step.status === 'doing' ? 'bg-[#7C3AED]/20 text-[#7C3AED]' : 'bg-gray-500/20 text-gray-500'}`}>
                  {step.status === 'todo' ? 'Pendente' : step.status === 'doing' ? 'Em Produção' : 'Concluído'}
                </span>
              )}
            </div>
            {contents.length > 0 && (
              <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(contents.filter(c => c.status === 'done' || c.status === 'finalizado').length / contents.length) * 100}%` }}
                  className="h-full bg-[#7C3AED]"
                />
              </div>
            )}
          </div>
        </div>
        
        <div className="flex gap-4 mt-2 border-b border-white/5">
          <button 
            onClick={() => { setActiveTab('contents'); setIsAddingContent(false); setEditingContentId(null); setMsg(''); }}
            className={`pb-2 text-[10px] font-bold uppercase tracking-widest transition-all relative ${activeTab === 'contents' ? 'text-[#7C3AED]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Conteúdos ({contents?.length || 0})
            {activeTab === 'contents' && <motion.div layoutId={`tab-${step.id}`} className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7C3AED]" />}
          </button>
          <button 
            onClick={() => { setActiveTab('chat'); setIsAddingContent(false); setEditingContentId(null); setMsg(''); }}
            className={`pb-2 text-[10px] font-bold uppercase tracking-widest transition-all relative ${activeTab === 'chat' ? 'text-[#7C3AED]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <div className="flex items-center gap-1.5">
              Chat
              {unreadCount > 0 && (
                <motion.span 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="bg-red-500 text-white text-[8px] px-1 rounded-full min-w-[14px] h-[14px] flex items-center justify-center border border-[#181820]"
                >
                  {unreadCount}
                </motion.span>
              )}
            </div>
            {activeTab === 'chat' && <motion.div layoutId={`tab-${step.id}`} className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7C3AED]" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative flex flex-col">
        <AnimatePresence mode="wait">
          {activeTab === 'chat' ? (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              ref={chatRef} 
              className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-hide bg-black/10"
            >
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-[10px] gap-2">
                  <div className="w-8 h-8 rounded-full border border-dashed border-gray-700 flex items-center justify-center">
                    <Activity size={14} />
                  </div>
                  <p className="italic">Inicie a conversa sobre esta etapa...</p>
                </div>
              ) : (
                messages.map(m => (
                  <div key={m.id} className={`flex gap-2 group ${m.userId === auth.currentUser?.uid ? 'flex-row-reverse' : ''}`}>
                    <img src={m.photo} className="w-7 h-7 rounded-full object-cover border border-white/10 flex-shrink-0" referrerPolicy="no-referrer" loading="lazy" />
                    <div className={`max-w-[85%] p-2.5 rounded-2xl text-[11px] shadow-sm relative ${m.userId === auth.currentUser?.uid ? 'bg-[#7C3AED] text-white rounded-tr-none' : 'bg-[#252533] text-gray-200 rounded-tl-none border border-white/5'}`}>
                      <div className="flex justify-between items-center gap-4 mb-1">
                        <span className="font-bold text-[9px] opacity-80">{m.user}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] opacity-50">{formatTime(m.timestamp)}</span>
                          {m.userId === auth.currentUser?.uid && (
                            <button 
                              onClick={() => onRemoveMessage(step.id, m.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-white/50 hover:text-white"
                              title="Apagar mensagem"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="leading-normal">{m.text}</p>
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="contents"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-hide bg-black/10"
            >
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Arquivos e Notas</h4>
                <div className="flex gap-2">
                  {canCreateContent && canEditStep && (
                    <button 
                      onClick={() => setIsAddingContent(true)}
                      className="p-1.5 bg-[#7C3AED]/10 text-[#7C3AED] rounded-lg hover:bg-[#7C3AED]/20 transition-all"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              </div>

              {isImporting && step.id === 5 && (
                <div className="mb-4 p-3 bg-black/30 rounded-xl border border-[#7C3AED]/20 flex flex-col gap-2">
                  <p className="text-[9px] font-bold text-[#7C3AED] uppercase tracking-widest mb-1">Conteúdos Disponíveis</p>
                  {(() => {
                    const available = [
                      ...(allContents[3] || []).map(c => ({ ...c, stepId: 3 })),
                      ...(allContents[4] || []).map(c => ({ ...c, stepId: 4 }))
                    ].filter(c => c.status === 'done' || c.status === 'finalizado');
                    
                    if (available.length === 0) return <p className="text-[8px] text-gray-600 italic">Nenhum conteúdo pronto para importação.</p>;
                    
                    return available.map(c => (
                      <button
                        key={c.id}
                        onClick={() => {
                          onAddContent(step.id, {
                            title: c.title,
                            description: c.description,
                            fileLink: c.fileLink,
                            type: c.type,
                            sourceStepId: c.stepId,
                            sourceContentId: c.id
                          });
                          setIsImporting(false);
                        }}
                        className="flex items-center justify-between p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-all text-left"
                      >
                        <div className="overflow-hidden pr-2">
                          <p className="text-[9px] font-bold text-white truncate">{c.title}</p>
                          <p className="text-[8px] text-gray-500 truncate">{c.description}</p>
                        </div>
                        <Plus size={12} className="text-[#7C3AED] flex-shrink-0" />
                      </button>
                    ));
                  })()}
                </div>
              )}

              {(!contents || contents.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-[10px] gap-2 py-10">
                  <Layout size={24} className="opacity-20" />
                  <p className="italic">Nenhum conteúdo adicionado ainda.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {contents.map(content => {
                    const sourceContent = getSourceContent(content);
                    const isLocked = (step.id === 1 || step.id === 2 || step.id === 4) && content.sentToNext;
                    const canEditThisContent = canEditStep && !isLocked;
                    const isExpanded = expandedContentId === content.id;

                    return (
                      <div key={content.id} className={`group flex flex-col border-b border-white/5 last:border-0 transition-all duration-300 ${isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.01]'}`}>
                        {/* Header - Compact Data Row */}
                        <div 
                          onClick={() => setExpandedContentId(isExpanded ? null : content.id)}
                          className="p-3 flex items-center gap-3 cursor-pointer"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${content.status === 'done' || content.status === 'finalizado' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : content.status === 'todo' ? 'bg-gray-600' : 'bg-[#7C3AED] shadow-[0_0_8px_rgba(124,58,237,0.5)]'}`} />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] font-medium text-white/90 truncate">{content.title}</p>
                              {content.fileLink && step.id !== 1 && <FileText size={10} className="text-gray-500 flex-shrink-0" />}
                            </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-bold ${content.status === 'done' || content.status === 'finalizado' ? 'bg-green-500/20 text-green-500' : content.status === 'todo' ? 'bg-gray-500/20 text-gray-500' : 'bg-[#7C3AED]/20 text-[#7C3AED]'}`}>
                                  {getStatusLabel(content.status || 'todo')}
                                </span>
                                <span className="text-[9px] text-gray-700">•</span>
                                <span className="text-[9px] text-gray-600">{formatTime(content.timestamp)}</span>
                              </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {content.assignedUserIds && content.assignedUserIds.length > 0 && (
                              <div className="flex -space-x-1">
                                {content.assignedUserIds.slice(0, 2).map(uid => {
                                  const user = allUsers.find(u => u.uid === uid);
                                  if (!user) return null;
                                  return (
                                    <img 
                                      key={uid}
                                      src={user.photo} 
                                      className="w-4 h-4 rounded-full border border-[#181820] object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  );
                                })}
                                {content.assignedUserIds.length > 2 && (
                                  <div className="w-4 h-4 rounded-full border border-[#181820] bg-gray-800 flex items-center justify-center text-[6px] text-white font-bold">
                                    +{content.assignedUserIds.length - 2}
                                  </div>
                                )}
                              </div>
                            )}
                            <motion.div
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              className="text-gray-600"
                            >
                              <ChevronRight size={12} />
                            </motion.div>
                          </div>
                        </div>

                        {/* Expanded Content - Technical Details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden bg-black/20"
                            >
                              <div className="px-3 pb-4 pt-1 flex flex-col gap-3">
                                {/* Details Grid */}
                                <div className="grid grid-cols-1 gap-3">
                                  {content.description && (
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[8px] text-gray-500 uppercase font-bold">Descrição</span>
                                      <p className="text-[10px] text-gray-400 leading-relaxed border-l-2 border-[#7C3AED]/30 pl-2 py-0.5">
                                        {content.description}
                                      </p>
                                    </div>
                                  )}

                                  <div className="flex flex-wrap gap-2 items-center">
                                    {content.fileLink && step.id !== 1 && (
                                      <a 
                                        href={content.fileLink.startsWith('http') ? content.fileLink : `https://${content.fileLink}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 text-gray-300 rounded border border-white/5 hover:bg-white/10 transition-all text-[9px] font-bold"
                                      >
                                        <ExternalLink size={10} />
                                        ARQUIVO
                                      </a>
                                    )}
                                    
                                    <div className="flex gap-1 ml-auto">
                                      {canEditThisContent && (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); handleEditContent(content); }}
                                          className="p-1.5 text-gray-500 hover:text-white transition-all"
                                          title="Editar"
                                        >
                                          <Edit2 size={12} />
                                        </button>
                                      )}
                                      {canEditThisContent && (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); onRemoveContent(step.id, content.id); }}
                                          className="p-1.5 text-gray-500 hover:text-red-400 transition-all"
                                          title="Excluir"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Source/Metadata */}
                                {sourceContent && (
                                  <div className="flex flex-col gap-2 p-2 bg-white/[0.02] rounded border border-white/5">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-[7px] text-[#7C3AED] uppercase font-bold">Origem</span>
                                      <p className="text-[9px] text-gray-500 truncate">{sourceContent.title}</p>
                                    </div>
                                  </div>
                                )}

                                {/* Status Selector - Hardware Style */}
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[8px] text-gray-500 uppercase font-bold">Status Produção</span>
                                  <div className="flex gap-1">
                                    {getStatusOptions(step.id).map(s => (
                                      <button
                                        key={s}
                                        disabled={!canEditThisContent}
                                        onClick={() => onUpdateContentStatus(step.id, content.id, s)}
                                        className={`flex-1 text-[8px] py-1 rounded border font-bold transition-all ${ (content.status || 'todo') === s ? (s === 'done' || s === 'finalizado' ? 'bg-green-500/20 border-green-500/50 text-green-500' : 'bg-[#7C3AED]/20 border-[#7C3AED]/50 text-[#7C3AED]') : 'bg-white/5 border-white/5 text-gray-600 hover:text-gray-400'} ${!canEditThisContent ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      >
                                        {getStatusLabel(s)}
                                      </button>
                                    ))}
                                    {content.readyForCalendar && !content.sentToNext && (step.id === 3 || step.id === 6) && (
                                      <button
                                        onClick={() => onSendToCalendar?.(content)}
                                        className="px-2 py-1 bg-[#7C3AED] text-white rounded text-[8px] font-bold hover:bg-[#6D31D1] transition-all flex items-center gap-1"
                                      >
                                        <Calendar size={10} /> AGENDAR
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {isAddingContent && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 bg-[#181820]/95 backdrop-blur-sm z-20 p-5 flex flex-col gap-4"
          >
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div className="flex flex-col">
                <h4 className="text-xs font-bold text-white tracking-widest">{editingContentId ? 'Editar Conteúdo' : 'Novo Conteúdo'}</h4>
              </div>
              <button onClick={() => { setIsAddingContent(false); setEditingContentId(null); setNewContentTitle(''); setNewContentDescription(''); setNewContentFileLink(''); }} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4 scrollbar-hide">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] text-gray-500 font-bold ml-1">Título do Conteúdo</label>
                <input 
                  type="text" 
                  placeholder="Ex: Divulgação de Evento Acadêmico"
                  className="bg-black/40 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] focus:outline-none focus:border-[#7C3AED]/50 text-white placeholder:text-gray-700 transition-all"
                  value={newContentTitle}
                  onChange={(e) => setNewContentTitle(e.target.value)}
                />
              </div>

              {![2, 4].includes(step.id) && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] text-gray-500 font-bold ml-1">Descrição</label>
                  <textarea 
                    placeholder="Insira a legenda da publicação"
                    className="h-24 bg-black/40 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] focus:outline-none focus:border-[#7C3AED]/50 text-white resize-none placeholder:text-gray-700 transition-all"
                    value={newContentDescription}
                    onChange={(e) => setNewContentDescription(e.target.value)}
                  />
                </div>
              )}

              {!(step.id === 1) && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] text-gray-500 font-bold ml-1">Link do Google Drive</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="https://drive.google.com/..."
                      className="flex-1 bg-black/40 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] focus:outline-none focus:border-[#7C3AED]/50 text-white placeholder:text-gray-700 transition-all"
                      value={newContentFileLink}
                      onChange={(e) => setNewContentFileLink(e.target.value)}
                    />
                    <a 
                      href="https://drive.google.com" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="w-10 h-10 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/10 transition-all flex-shrink-0"
                      title="Abrir Google Drive"
                    >
                      <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" className="w-4 h-4" alt="Drive" loading="lazy" referrerPolicy="no-referrer" />
                    </a>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] text-gray-500 font-bold ml-1">Responsáveis Designados</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-black/40 rounded-lg border border-white/5">
                  {allUsers.map(user => (
                    <button
                      key={user.uid}
                      onClick={() => {
                        if (newContentAssignedUserIds.includes(user.uid!)) {
                          setNewContentAssignedUserIds(newContentAssignedUserIds.filter(id => id !== user.uid));
                        } else {
                          setNewContentAssignedUserIds([...newContentAssignedUserIds, user.uid!]);
                        }
                      }}
                      className={`flex items-center gap-1.5 p-1 rounded-md border transition-all ${newContentAssignedUserIds.includes(user.uid!) ? 'bg-[#7C3AED]/20 border-[#7C3AED]/40 text-white' : 'bg-white/5 border-transparent text-gray-500 hover:bg-white/10'}`}
                    >
                      <img src={user.photo} className="w-4 h-4 rounded-full object-cover" referrerPolicy="no-referrer" />
                      <span className="text-[9px] font-medium">{user.firstname}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/5">
              <button 
                onClick={handleAddContent}
                disabled={!newContentTitle.trim() || (![2, 4, 6].includes(step.id) && !newContentDescription.trim())}
                className={`w-full py-3 rounded-lg text-[10px] font-bold tracking-widest transition-all ${newContentTitle.trim() && ([2, 4, 6].includes(step.id) || newContentDescription.trim()) ? 'bg-[#7C3AED] text-white hover:bg-[#6D31D1] shadow-[0_0_15px_rgba(124,58,237,0.3)]' : 'bg-white/5 text-gray-600 cursor-not-allowed'}`}
              >
                {editingContentId ? 'Confirmar Alterações' : 'Criar Novo Conteúdo'}
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {activeTab === 'chat' && !isAddingContent && (
        <div className="p-4 bg-[#1B1B26] border-t border-white/5 flex gap-2">
          <input 
            type="text" 
            placeholder="Mensagem..."
            className="flex-1 bg-black/20 border border-white/5 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-[#7C3AED]/30 transition-colors text-white"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button 
            onClick={handleSend}
            disabled={!msg.trim()}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${msg.trim() ? 'bg-[#7C3AED] text-white hover:scale-105 active:scale-95' : 'bg-white/5 text-gray-600'}`}
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </motion.div>
  );
});

const CopyableText = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group/desc">
      <div className="p-4 bg-black/20 rounded-xl border border-white/5 text-sm text-gray-400 mb-4 leading-relaxed whitespace-pre-wrap pr-10">
        {text}
      </div>
      <button 
        onClick={handleCopy}
        className={`absolute top-2 right-2 p-2 rounded-lg transition-all flex items-center justify-center ${copied ? 'bg-green-500/20 text-green-400' : 'bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white opacity-0 group-hover/desc:opacity-100'}`}
        title="Copiar texto"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
};

const CalendarView = React.memo<{
  productionSteps: ProductionStep[];
  scheduledTasks: ScheduledTask[];
  onAddScheduledTask: (task: Omit<ScheduledTask, 'id'>) => void;
  onUpdateScheduledTask: (id: string, updates: Partial<ScheduledTask>) => void;
  onRemoveScheduledTask: (id: string) => void;
  currentUser: UserData;
}>(({ productionSteps, scheduledTasks, onAddScheduledTask, onUpdateScheduledTask, onRemoveScheduledTask, currentUser }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(new Date().toISOString().split('T')[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDayDetailsOpen, setIsDayDetailsOpen] = useState(false);
  const [isAutoScheduleOpen, setIsAutoScheduleOpen] = useState(false);
  const [autoScheduleData, setAutoScheduleData] = useState<{stepId: number, content: ProductionContent} | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [selectedContentTitle, setSelectedContentTitle] = useState<string>('');
  const [time, setTime] = useState('12:00');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'Agendado' | 'Publicado'>('Agendado');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const allContents = React.useMemo(() => {
    return Object.fromEntries(productionSteps.map(s => [s.id, s.contents || []]));
  }, [productionSteps]);

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDay(dateStr);
    setIsDayDetailsOpen(true);
  };

  const openAddModal = () => {
    setIsModalOpen(true);
    setEditingTaskId(null);
    setSelectedStepId(null);
    setSelectedContentId(null);
    setSelectedContentTitle('');
    setTime('12:00');
    setDescription('');
    setSearchTerm('');
    setStatus('Agendado');
  };

  const handleEditTask = (task: ScheduledTask) => {
    setEditingTaskId(task.id);
    setSelectedStepId(task.stepId);
    setSelectedContentTitle(task.contentTitle || '');
    setTime(task.time);
    setDescription(task.description);
    setSelectedDay(task.date);
    setStatus(task.status || 'Agendado');
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!selectedStepId || !selectedDay) return;

    if (editingTaskId) {
      onUpdateScheduledTask(editingTaskId, { time, description, status });
    } else {
      // Get Copy and Roteiro contents automatically
      const copyStep = productionSteps.find(s => s.id === 1);
      const roteiroStep = productionSteps.find(s => s.id === 2);
      
      let autoDescription = "";
      
      // Pull Copy (1) for both Criativo and Edição
      const copyContents = allContents[1] || [];
      if (copyContents.length > 0) {
        autoDescription += "\n\n--- COPY ---\n" + copyContents.map(c => `${c.title}:\n${c.description || ''}`).join('\n\n');
      }

      // Pull Roteiro (2) and Captação (4) only for Edição (6)
      if (selectedStepId === 6) {
        const roteiroContents = allContents[2] || [];
        if (roteiroContents.length > 0) {
          autoDescription += "\n\n--- ROTEIRO ---\n" + roteiroContents.map(c => `${c.title}:\n${c.description || ''}`).join('\n\n');
        }
        const captacaoContents = allContents[4] || [];
        if (captacaoContents.length > 0) {
          autoDescription += "\n\n--- CAPTAÇÃO ---\n" + captacaoContents.map(c => `${c.title}:\n${c.description || ''}`).join('\n\n');
        }
      }

      onAddScheduledTask({
        stepId: selectedStepId,
        contentTitle: selectedContentTitle,
        date: selectedDay,
        time,
        description: description + autoDescription,
        status
      });
    }
    setIsModalOpen(false);
    setEditingTaskId(null);
    setSelectedStepId(null);
    setSelectedContentId(null);
    setSelectedContentTitle('');
    setTime('12:00');
    setDescription('');
    setSearchTerm('');
    setStatus('Agendado');
  };

  const availableContents = React.useMemo(() => {
    if (!searchTerm.trim()) return [];
    return productionSteps
      .filter(step => step.id === 3 || step.id === 6)
      .flatMap(step => (allContents[step.id] || [])
        .filter(c => (c.status === 'done' || c.status === 'finalizado') && c.title.toLowerCase().includes(searchTerm.toLowerCase()))
        .map(c => ({ ...c, stepId: step.id, stepTitle: step.title }))
      );
  }, [productionSteps, allContents, searchTerm]);

  const getTasksForDay = React.useCallback((dateString: string) => {
    const tasks = scheduledTasks.filter(t => t.date === dateString && (t.stepId === 3 || t.stepId === 6));
    
    // Also get completed contents for this day, grouped by step
    const completedByStep: Record<number, any> = {};
    productionSteps.filter(s => s.id === 3 || s.id === 6).forEach(step => {
      const contents = allContents[step.id] || [];
      const doneInStep = contents.filter(c => (c.status === 'done' || c.status === 'finalizado') && c.completionDate === dateString);
      
      if (doneInStep.length > 0) {
        completedByStep[step.id] = {
          id: `content-step-${step.id}-${dateString}`,
          stepId: step.id,
          date: dateString,
          time: doneInStep[0].timestamp,
          description: step.title,
          count: doneInStep.length,
          isContent: true
        };
      }
    });

    return [...tasks, ...Object.values(completedByStep)];
  }, [scheduledTasks, productionSteps, allContents]);

  const selectedDayTasks = React.useMemo(() => {
    if (!selectedDay) return [];
    return getTasksForDay(selectedDay);
  }, [selectedDay, getTasksForDay]);

  return (
    <div className="flex flex-col max-w-6xl mx-auto px-2 sm:px-0">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold mb-1">{monthNames[month]} {year}</h2>
          <p className="text-xs sm:text-sm text-gray-500">Gerencie o cronograma de postagens planejadas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Calendar Grid */}
        <motion.div 
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.x > 100) prevMonth();
            else if (info.offset.x < -100) nextMonth();
          }}
          className="bg-[#181820] rounded-[24px] border border-white/5 p-6 sm:p-10 shadow-2xl overflow-hidden cursor-grab active:cursor-grabbing"
        >
          <div className="grid grid-cols-7 gap-2 sm:gap-4 mb-6">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(day => (
              <div key={day} className="text-center text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-widest py-2">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-2 sm:gap-4">
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-[1/1.1] bg-white/[0.01] rounded-lg sm:rounded-2xl border border-dashed border-white/5 opacity-20" />
            ))}

            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayTasks = getTasksForDay(dateStr);
              const academicEvents = ACADEMIC_CALENDAR_2026.filter(e => e.date === dateStr);
              const isToday = new Date().toDateString() === new Date(year, month, dayNum).toDateString();
              const isSelected = selectedDay === dateStr;
              const isHoliday = academicEvents.some(e => e.type === 'holiday');
              const isRecess = academicEvents.some(e => e.type === 'recess');
              const isAcademic = academicEvents.some(e => e.type === 'academic');
              const totalDayTasksCount = scheduledTasks.filter(t => t.date === dateStr && (t.stepId === 3 || t.stepId === 6)).length;

              return (
                <div 
                  key={dayNum} 
                  onClick={() => handleDayClick(dayNum)}
                  className={`aspect-[1/1.1] bg-[#1B1B26] rounded-lg sm:rounded-2xl p-2 sm:p-3 border transition-all cursor-pointer group flex flex-col items-center justify-center gap-1 relative overflow-hidden ${
                    isSelected 
                      ? 'border-[#7C3AED] bg-[#7C3AED]/20 shadow-[0_0_15px_rgba(124,58,237,0.3)]' 
                      : isHoliday
                        ? 'border-red-500/30 bg-red-500/5'
                        : isRecess
                          ? 'border-amber-500/30 bg-amber-500/5'
                          : isAcademic
                            ? 'border-blue-500/30 bg-blue-500/5'
                            : dayTasks.length > 0 
                              ? 'border-[#7C3AED] bg-[#7C3AED]/5' 
                              : isToday 
                                ? 'border-[#7C3AED]/40 bg-[#7C3AED]/5' 
                                : 'border-white/5 hover:border-[#7C3AED]/30 hover:bg-[#252533]'
                  }`}
                >
                  {totalDayTasksCount > 3 && (
                    <div className="absolute top-1 right-1 z-10">
                      <AlertTriangle size={10} className="text-amber-500 animate-pulse" />
                    </div>
                  )}
                  <div className={`text-[10px] sm:text-xs font-bold transition-all flex-shrink-0 text-center leading-none ${
                    isSelected || dayTasks.length > 0 
                      ? 'text-white' 
                      : isToday 
                        ? 'text-[#D1AEFF]' 
                        : isHoliday
                          ? 'text-red-400'
                          : isRecess
                            ? 'text-amber-400'
                            : isAcademic
                              ? 'text-blue-400'
                              : 'text-gray-500 group-hover:text-gray-300'
                  }`}>
                    {dayNum}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-8 flex flex-wrap gap-4 pt-6 border-t border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/60" />
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Feriado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500/40 border border-amber-500/60" />
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Recesso</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500/40 border border-blue-500/60" />
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Início/Fim Semestre</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#7C3AED]/40 border border-[#7C3AED]/60" />
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Postagens Programadas</span>
            </div>
          </div>
        </motion.div>

        {/* Completed Contents List Card */}
        <div className="bg-[#181820] p-8 rounded-[32px] border border-white/5 shadow-2xl">
          <div className="mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 size={20} className="text-green-500" />
              Conteúdos da Semana
            </h3>
            <p className="text-xs text-gray-500">Conteúdos finalizados aguardando publicação.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {productionSteps
              .filter(s => s.id === 3 || s.id === 6)
              .flatMap(s => (s.contents || []).map(c => ({ ...c, stepId: s.id })))
              .filter(c => c.status === 'done' || c.status === 'finalizado')
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .slice(0, 6)
              .map(content => (
                <div key={content.id} className="p-4 bg-[#1B1B26] rounded-2xl border border-white/5 hover:border-[#7C3AED]/30 transition-all group">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-green-500/20 text-green-400">
                      Concluído
                    </span>
                    <span className="text-[10px] font-mono text-gray-500">{new Date(content.timestamp).toLocaleDateString()}</span>
                  </div>
                  <h4 className="text-sm font-bold mb-1 group-hover:text-[#7C3AED] transition-colors">{content.title}</h4>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-3">
                    {productionSteps.find(s => s.id === content.stepId)?.title}
                  </p>
                  {content.fileLink && (
                    <a 
                      href={content.fileLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-[#7C3AED] font-bold hover:underline"
                    >
                      <ExternalLink size={12} />
                      VER ARQUIVO NO DRIVE
                    </a>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isDayDetailsOpen && selectedDay && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-[#181820] p-6 sm:p-8 rounded-[32px] w-full max-w-[520px] shadow-2xl border border-white/10 relative"
            >
              <button 
                onClick={() => setIsDayDetailsOpen(false)}
                className="absolute top-6 right-6 p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>

              <div className="mb-8">
                <h3 className="text-2xl font-bold mb-1">{selectedDay.split('-').reverse().join('/')}</h3>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Detalhes do Dia</p>
              </div>

              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 scrollbar-hide">
                {/* Academic Events */}
                {ACADEMIC_CALENDAR_2026.filter(e => e.date === selectedDay).map((event, idx) => (
                  <div key={`ev-${idx}`} className={`p-4 rounded-2xl border ${
                    event.type === 'holiday' ? 'bg-red-500/5 border-red-500/20' : 
                    event.type === 'recess' ? 'bg-amber-500/5 border-amber-500/20' : 
                    'bg-blue-500/5 border-blue-500/20'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${
                        event.type === 'holiday' ? 'bg-red-500' : 
                        event.type === 'recess' ? 'bg-amber-500' : 
                        'bg-blue-500'
                      }`} />
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${
                        event.type === 'holiday' ? 'text-red-400' : 
                        event.type === 'recess' ? 'text-amber-400' : 
                        'text-blue-400'
                      }`}>
                        {event.type === 'holiday' ? 'Feriado' : event.type === 'recess' ? 'Recesso' : 'Acadêmico'}
                      </span>
                    </div>
                    <h4 className="text-lg font-bold">{event.title}</h4>
                  </div>
                ))}

                {/* Scheduled Tasks */}
                {scheduledTasks.filter(t => t.date === selectedDay).map(task => {
                  const step = productionSteps.find(s => s.id === task.stepId);
                  return (
                    <div key={task.id} className="p-5 bg-[#1B1B26] rounded-2xl border border-white/5">
                      <div className="flex justify-between items-start mb-4">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-[#7C3AED]/20 text-[#D1AEFF]">
                          {task.status}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{task.time}</span>
                      </div>
                      <h4 className="text-lg font-bold mb-2">{task.contentTitle || step?.title}</h4>
                      {task.description && (
                        <CopyableText text={task.description} />
                      )}
                      
                      {task.finalFileLink && (
                        <div className="mt-4 p-4 bg-black/20 rounded-xl border border-white/5">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Visualização</span>
                            <a 
                              href={task.finalFileLink} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#7C3AED] font-bold hover:underline flex items-center gap-1"
                            >
                              <ExternalLink size={12} /> DRIVE
                            </a>
                          </div>
                          <div className="aspect-video rounded-lg bg-black/40 flex items-center justify-center border border-white/5 overflow-hidden">
                            {task.finalFileLink.includes('drive.google.com') ? (
                              <div className="text-center p-4">
                                <FileText size={32} className="mx-auto text-gray-700 mb-2" />
                                <p className="text-[10px] text-gray-500 italic">Arquivo do Google Drive</p>
                                <p className="text-[8px] text-gray-600 mt-1 truncate max-w-[200px]">{task.finalFileLink}</p>
                              </div>
                            ) : (
                              <img src={task.finalFileLink} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {ACADEMIC_CALENDAR_2026.filter(e => e.date === selectedDay).length === 0 && 
                 scheduledTasks.filter(t => t.date === selectedDay).length === 0 && (
                  <div className="py-12 text-center opacity-40">
                    <Calendar size={40} className="mx-auto mb-4" />
                    <p className="text-sm italic">Nenhuma atividade programada para este dia.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="auth-card w-full max-w-[480px]"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="text-left">
                  <h2 className="logo-text text-white mb-2">
                    {editingTaskId ? 'Editar Postagem' : 'Agendar Postagem'}
                  </h2>
                  <p className="subtitle">Configure os detalhes da sua publicação planejada.</p>
                </div>
                <button onClick={() => {
                  setIsModalOpen(false);
                  setEditingTaskId(null);
                  setSelectedStepId(null);
                  setSelectedContentId(null);
                  setSelectedContentTitle('');
                  setTime('12:00');
                  setDescription('');
                  setSearchTerm('');
                  setStatus('Agendado');
                }} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#7C3AED]/10 rounded-lg w-fit border border-[#7C3AED]/20">
                  <Calendar size={14} className="text-[#7C3AED]" />
                  <span className="text-[10px] text-[#D1AEFF] font-bold tracking-widest">
                    {selectedDay?.split('-').reverse().join(' / ')}
                  </span>
                </div>

                {!editingTaskId && (
                  <div className="flex flex-col gap-3">
                    <label className="text-xs text-white/60 font-medium ml-1">Selecionar Postagem (A fazer)</label>
                    <div className="relative">
                      <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input 
                        type="text" 
                        placeholder="Pesquisar pelo nome..."
                        className="input-field pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    
                    <div className="max-h-[180px] overflow-y-auto flex flex-col gap-2 mt-1 pr-1 scrollbar-hide">
                      {availableContents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 bg-black/10 rounded-2xl border border-dashed border-white/5">
                          <Activity size={24} className="text-gray-700 mb-2" />
                          <p className="text-[10px] text-gray-600 italic">Nenhum tópico disponível para agendamento.</p>
                        </div>
                      ) : (
                        availableContents.map(content => (
                          <div 
                            key={content.id}
                            onClick={() => {
                              setSelectedStepId(content.stepId);
                              setSelectedContentId(content.id);
                              setSelectedContentTitle(content.title);
                            }}
                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between group ${selectedContentId === content.id ? 'bg-[#7C3AED] border-[#7C3AED] text-white shadow-lg shadow-[#7C3AED]/20' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:border-white/10'}`}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${selectedContentId === content.id ? 'bg-white' : 'bg-gray-600'}`} />
                                <span className="text-xs font-bold">{content.title}</span>
                              </div>
                              <span className={`text-[9px] ml-5 ${selectedContentId === content.id ? 'text-white/60' : 'text-gray-500'}`}>{content.stepTitle}</span>
                            </div>
                            <Plus size={16} className={selectedContentId === content.id ? 'text-white' : 'text-gray-600 group-hover:text-gray-400'} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {editingTaskId && (
                  <div className="p-5 bg-gradient-to-r from-[#7C3AED]/20 to-transparent rounded-2xl border border-[#7C3AED]/30 flex items-center gap-4">
                    <div className="w-10 h-10 bg-[#7C3AED] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#7C3AED]/30">
                      <Layers size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#D1AEFF] font-bold mb-0.5">Postagem Selecionada</p>
                      <p className="text-sm font-bold text-white">
                        {selectedContentTitle || productionSteps.find(s => s.id === selectedStepId)?.title}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-white/60 font-medium ml-1">Horário da Publicação</label>
                  <div className="relative">
                    <Clock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input 
                      type="time" 
                      className="input-field pl-12"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-xs text-white/60 font-medium ml-1">Descrição</label>
                  <textarea 
                    placeholder="Adicione notas, legendas ou observações importantes..."
                    className="input-field min-h-[120px] resize-none leading-relaxed py-4"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="flex gap-4 mt-4">
                  {editingTaskId && isUserAdmin(currentUser) && (
                    <button 
                      onClick={() => {
                        onRemoveScheduledTask(editingTaskId);
                        setIsModalOpen(false);
                      }}
                      className="flex-1 py-4 rounded-xl bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20 hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 size={18} /> Remover
                    </button>
                  )}
                  <button 
                    onClick={handleSave}
                    disabled={!selectedStepId}
                    className={`flex-[2] primary-btn flex items-center justify-center gap-2 ${!selectedStepId ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {editingTaskId ? <Edit2 size={18} /> : <CheckCircle2 size={18} />}
                    {editingTaskId ? 'Salvar Alterações' : 'Confirmar Agendamento'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

// Helper function to compress images
const compressImage = (base64Str: string, maxWidth = 200, maxHeight = 200): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => {
      resolve(base64Str); // Fallback to original if error
    };
  });
};

const BackgroundLights = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
    <motion.div 
      animate={{
        x: [0, 100, -50],
        y: [0, 50, 100],
        scale: [1, 1.2, 1],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        repeatType: "reverse",
      }}
      className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#7C3AED]/20 rounded-full blur-[120px]"
    />
    <motion.div 
      animate={{
        x: [0, -80, 40],
        y: [0, -100, -20],
        scale: [1, 0.8, 1.1],
      }}
      transition={{
        duration: 25,
        repeat: Infinity,
        repeatType: "reverse",
      }}
      className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#7C3AED]/15 rounded-full blur-[120px]"
    />
    <motion.div 
      animate={{
        x: [0, 60, -30],
        y: [0, -40, 60],
        opacity: [0.3, 0.6, 0.3],
      }}
      transition={{
        duration: 15,
        repeat: Infinity,
        repeatType: "reverse",
      }}
      className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-[#7C3AED]/10 rounded-full blur-[100px]"
    />
  </div>
);

const LoginView = React.memo(({
  loginName,
  setLoginName,
  loginNameError,
  setLoginNameError,
  loginPassword,
  setLoginPassword,
  loginPasswordError,
  setLoginPasswordError,
  showLoginPassword,
  setShowLoginPassword,
  loginErrorMessage,
  handleLogin,
  isLoggingIn,
  setView
}: any) => (
  <motion.div 
    key="login"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="auth-card"
  >
    <div className="logo-container">
      <h1 className="logo-text">
        <span className="fatec">Fatec</span> <span className="social">Social</span>
      </h1>
      <p className="subtitle">Gerenciador de Tarefas</p>
    </div>

    <div className="flex flex-col gap-3 w-full max-w-[280px] mx-auto">
      <input 
        type="email" 
        placeholder="E-mail" 
        className={`input-field ${loginNameError ? 'border-red-500' : ''}`}
        value={loginName}
        onChange={(e) => {
          setLoginName(e.target.value);
          if (loginNameError) setLoginNameError(false);
        }}
      />
      <div className="relative">
        <input 
          type={showLoginPassword ? "text" : "password"} 
          placeholder="Senha" 
          className={`input-field pr-10 ${loginPasswordError ? 'border-red-500' : ''}`}
          value={loginPassword}
          onChange={(e) => {
            setLoginPassword(e.target.value);
            if (loginPasswordError) setLoginPasswordError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />
        <button 
          type="button"
          onClick={() => setShowLoginPassword(!showLoginPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
        >
          {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div className="flex justify-between items-center w-full max-w-[280px] mx-auto mt-1">
        <div className="flex-1 text-left overflow-hidden">
          {loginErrorMessage && (
            <p className="text-xs text-red-500 font-bold animate-pulse truncate mr-2">
              {loginErrorMessage}
            </p>
          )}
        </div>
        <span 
          className="text-xs text-gray-500 hover:text-[#7C3AED] cursor-pointer transition-colors shrink-0"
          onClick={() => setView('forgot-password')}
        >
          Esqueceu a senha?
        </span>
      </div>
    </div>
    
    <div className="flex flex-col gap-3">
      <button 
        onClick={handleLogin} 
        disabled={isLoggingIn}
        className="primary-btn w-full max-w-[280px] mx-auto disabled:opacity-50"
      >
        {isLoggingIn ? 'Entrando...' : 'Entrar na Plataforma'}
      </button>

      <div className="text-xs text-gray-500 mt-1 text-center">
        <span>Ainda não tem conta? <span className="text-[#7C3AED] font-bold cursor-pointer hover:underline" onClick={() => setView('create')}>Cadastre-se</span></span>
      </div>
    </div>
  </motion.div>
));

const ForgotPasswordView = React.memo(({
  forgotSuccess,
  forgotEmail,
  setForgotEmail,
  forgotErrorMessage,
  handleForgotPassword,
  isSendingReset,
  setView
}: any) => (
  <motion.div 
    key="forgot"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="auth-card"
  >
    <div className="logo-container">
      <h1 className="logo-text">
        <span className="fatec">Fatec</span> <span className="social">Social</span>
      </h1>
      <p className="subtitle">Gerenciador de Tarefas</p>
    </div>

    {!forgotSuccess ? (
      <div className="flex flex-col gap-3 w-full max-w-[280px] mx-auto -mt-4">
        <p className="text-sm text-gray-400 text-center px-2">
          Digite seu e-mail para receber um link de redefinição de senha.
        </p>
        <input 
          type="email" 
          placeholder="E-mail" 
          className="input-field"
          value={forgotEmail}
          onChange={(e) => setForgotEmail(e.target.value)}
        />
        <button 
          onClick={handleForgotPassword} 
          disabled={isSendingReset}
          className="primary-btn w-full disabled:opacity-50"
        >
          {isSendingReset ? 'Enviando...' : 'Enviar Link'}
        </button>

        <div className="flex flex-col items-center w-full max-w-[280px] mx-auto mt-1 gap-1">
          {forgotErrorMessage && (
            <p className="text-xs text-red-500 font-bold animate-pulse text-center">
              {forgotErrorMessage}
            </p>
          )}
          <span 
            className="text-xs text-[#7C3AED] font-bold cursor-pointer hover:underline flex items-center justify-center gap-1" 
            onClick={() => setView('login')}
          >
            Voltar ao Login
          </span>
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-3 w-full max-w-[280px] mx-auto text-center">
        <div className="flex justify-center text-green-500 mb-2">
          <CheckCircle2 size={48} />
        </div>
        <h3 className="text-white font-bold">E-mail Enviado!</h3>
        <p className="text-xs text-gray-400">
          Se o e-mail <strong>{forgotEmail}</strong> estiver em nossa base, você receberá instruções para redefinir sua senha em instantes.
        </p>
        
        <div className="mt-1">
          <span 
            className="text-xs text-[#7C3AED] font-bold cursor-pointer hover:underline flex items-center justify-center gap-1" 
            onClick={() => setView('login')}
          >
            Voltar ao Login
          </span>
        </div>
      </div>
    )}
  </motion.div>
));

const RegisterView = React.memo(({
  photoError,
  isCompressingPhoto,
  photoPreview,
  fileInputRef,
  setCreatePhoto,
  setPhotoError,
  setIsCompressingPhoto,
  compressImage,
  setPhotoPreview,
  createFirstname,
  setCreateFirstname,
  firstnameError,
  setFirstnameError,
  createLastname,
  setCreateLastname,
  lastnameError,
  setLastnameError,
  createEmail,
  setCreateEmail,
  emailError,
  setEmailError,
  showCreatePassword,
  setShowCreatePassword,
  createPassword,
  setCreatePassword,
  passwordError,
  setPasswordError,
  showConfirmPassword,
  setShowConfirmPassword,
  createConfirm,
  setCreateConfirm,
  confirmError,
  setConfirmError,
  errorMessage,
  handleCreateAccount,
  isCreatingAccount,
  setView
}: any) => (
  <motion.div 
    key="create"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="auth-card"
  >
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <div 
          className={`w-28 h-28 rounded-full border-2 border-solid mx-auto cursor-pointer flex items-center justify-center overflow-hidden transition-all hover:bg-white/5 ${photoError ? 'border-red-500' : 'border-[#7C3AED]'}`}
          onClick={() => !isCompressingPhoto && fileInputRef.current?.click()}
        >
          {isCompressingPhoto ? (
            <div className="w-6 h-6 border-2 border-[#7C3AED] border-t-transparent rounded-full animate-spin"></div>
          ) : photoPreview ? (
            <img src={photoPreview} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <Camera size={28} className={photoError ? 'text-red-500' : 'text-[#7C3AED]'} strokeWidth={1.5} />
          )}
        </div>
        <span className={`text-sm font-medium ${photoError ? 'text-red-500' : 'text-[#7C3AED]'}`}>Foto de Perfil</span>
      </div>

      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef}
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setCreatePhoto(file);
            setPhotoError(false);
            setIsCompressingPhoto(true);
            
            const reader = new FileReader();
            reader.onloadend = async () => {
              try {
                const compressed = await compressImage(reader.result as string);
                setPhotoPreview(compressed);
              } catch (err) {
                handleFirestoreError(err, OperationType.CLIENT, 'compress-photo');
              } finally {
                setIsCompressingPhoto(false);
              }
            };
            reader.readAsDataURL(file);
          }
        }}
      />

      <div className="flex flex-col gap-3 w-full max-w-[280px] mx-auto">
        <input 
          type="text" 
          placeholder="Nome" 
          className={`input-field ${firstnameError ? 'border-red-500' : ''}`}
          value={createFirstname}
          onChange={(e) => {
            setCreateFirstname(e.target.value);
            if (firstnameError) setFirstnameError(false);
          }}
        />
        <input 
          type="text" 
          placeholder="Sobrenome" 
          className={`input-field ${lastnameError ? 'border-red-500' : ''}`}
          value={createLastname}
          onChange={(e) => {
            setCreateLastname(e.target.value);
            if (lastnameError) setLastnameError(false);
          }}
        />
        <input 
          type="email" 
          placeholder="E-mail" 
          className={`input-field ${emailError ? 'border-red-500' : ''}`}
          value={createEmail}
          onChange={(e) => {
            setCreateEmail(e.target.value);
            if (emailError) setEmailError(false);
          }}
        />
        <div className="relative">
          <input 
            type={showCreatePassword ? "text" : "password"} 
            placeholder="Senha" 
            className={`input-field pr-10 ${passwordError ? 'border-red-500' : ''}`}
            value={createPassword}
            onChange={(e) => {
              setCreatePassword(e.target.value);
              if (passwordError) setPasswordError(false);
            }}
          />
          <button 
            type="button"
            onClick={() => setShowCreatePassword(!showCreatePassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
          >
            {showCreatePassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="relative">
          <input 
            type={showConfirmPassword ? "text" : "password"} 
            placeholder="Confirmar Senha" 
            className={`input-field pr-10 ${confirmError ? 'border-red-500' : ''}`}
            value={createConfirm}
            onChange={(e) => {
              setCreateConfirm(e.target.value);
              if (confirmError) setConfirmError(false);
            }}
          />
          <button 
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
          >
            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
      <button 
        onClick={handleCreateAccount} 
        disabled={isCreatingAccount}
        className="primary-btn w-full max-w-[280px] mx-auto disabled:opacity-50"
      >
        {isCreatingAccount ? 'Criando Conta...' : 'Finalizar Cadastro'}
      </button>

      <div className="flex flex-col items-center w-full max-w-[280px] mx-auto mt-1 gap-1">
        {errorMessage && (
          <p className="text-xs text-red-500 font-bold animate-pulse text-center">
            {errorMessage}
          </p>
        )}
        <div className="text-xs text-gray-500 text-center">
          <span>Já possui conta? <span className="text-[#7C3AED] font-bold cursor-pointer hover:underline" onClick={() => setView('login')}>Fazer Login</span></span>
        </div>
      </div>
    </div>
  </div>
</motion.div>
));

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardTab: string;
  setDashboardTab: (tab: string) => void;
  isAdminPanelOpen: boolean;
  setIsAdminPanelOpen: (open: boolean) => void;
  isAdminVerified: boolean;
  onLogout: () => void;
}

const Sidebar = React.memo(({
  isOpen,
  onClose,
  dashboardTab,
  setDashboardTab,
  isAdminPanelOpen,
  setIsAdminPanelOpen,
  isAdminVerified,
  onLogout
}: SidebarProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 z-10 md:hidden"
          />
          <motion.aside
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            exit={{ x: -260 }}
            className="absolute left-0 top-0 w-[260px] h-full bg-[#181820] border-r border-white/5 p-4 z-20 flex flex-col"
          >
            <div className="flex-1">
              <ul className="flex flex-col gap-1">
                <li 
                  onClick={() => { setDashboardTab('production'); setIsAdminPanelOpen(false); }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${dashboardTab === 'production' && !isAdminPanelOpen ? 'bg-[#7C3AED]/10 text-[#D1AEFF] font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Layers size={18} /> Fluxo de Produção
                </li>
                <li 
                  onClick={() => { setDashboardTab('calendar'); setIsAdminPanelOpen(false); }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${dashboardTab === 'calendar' && !isAdminPanelOpen ? 'bg-[#7C3AED]/10 text-[#D1AEFF] font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Calendar size={18} /> Calendário
                </li>
                <li 
                  onClick={() => { setDashboardTab('metrics'); setIsAdminPanelOpen(false); }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${dashboardTab === 'metrics' && !isAdminPanelOpen ? 'bg-[#7C3AED]/10 text-[#D1AEFF] font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <BarChart3 size={18} /> Métricas
                </li>
                <li 
                  onClick={() => {
                    setIsAdminPanelOpen(true);
                  }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${isAdminPanelOpen ? 'bg-[#7C3AED]/10 text-[#D1AEFF] font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <Users size={18} /> Membros da Equipe
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-white/5">
              <button 
                onClick={onLogout}
                className="flex items-center gap-3 w-full p-2.5 rounded-lg cursor-pointer text-red-400 hover:bg-red-500/10 transition-all"
              >
                <LogOut size={18} /> Sair
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
});

interface AdminPanelProps {
  membersTab: string;
  setMembersTab: (tab: string) => void;
  users: UserData[];
  editingUserRoles: string | null;
  setEditingUserRoles: (email: string | null) => void;
  toggleUserRole: (email: string, role: string) => void;
  AVAILABLE_ROLES: string[];
  currentUser: UserData | null;
  setIsAdminPopupOpen: (open: boolean) => void;
  isAdminVerified: boolean;
  verificationPassword: string;
  setVerificationPassword: (val: string) => void;
  handleAdminLogin: () => void;
  onClearAllContents: () => void;
}

const AdminPanel = React.memo(({
  membersTab,
  setMembersTab,
  users,
  editingUserRoles,
  setEditingUserRoles,
  toggleUserRole,
  AVAILABLE_ROLES,
  currentUser,
  setIsAdminPopupOpen,
  isAdminVerified,
  verificationPassword,
  setVerificationPassword,
  handleAdminLogin,
  onClearAllContents
}: AdminPanelProps) => {
  const isCurrentUserAdmin = isUserAdmin(currentUser);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#181820] p-6 rounded-[20px] border border-white/5 max-w-4xl mx-auto w-full"
    >
      <div className="flex flex-col mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold">Membros da Equipe</h2>
            <p className="text-sm text-gray-500">
              Gerencie todos os membros ativos do Fatec Social.
            </p>
          </div>
        </div>
        
        {!isAdminVerified && (
          <button 
            onClick={() => setIsAdminPopupOpen(true)}
            className="mt-6 flex items-center gap-3 bg-white/5 p-4 rounded-xl border border-white/5 hover:bg-white/10 transition-all w-full group"
          >
            <div className="w-10 h-10 bg-[#7C3AED]/20 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
              <Shield size={20} className="text-[#7C3AED]" />
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Acesso Restrito</p>
              <p className="text-sm font-bold text-[#D1AEFF]">Tornar-se Administrador</p>
            </div>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {users.length === 0 ? (
          <div className="col-span-full p-10 text-center bg-[#1B1B26] rounded-2xl border border-dashed border-white/10">
            <User size={48} className="mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 italic">Nenhum outro usuário cadastrado no momento.</p>
          </div>
        ) : (
          users.map((u) => (
            <div key={u.uid || u.email} className="flex flex-col p-4 bg-[#1B1B26] rounded-xl border border-white/5 hover:border-[#7C3AED]/30 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div 
                  className={`flex items-center gap-4 group ${isCurrentUserAdmin ? 'cursor-pointer' : ''}`}
                  onClick={() => isCurrentUserAdmin && setEditingUserRoles(editingUserRoles === u.email ? null : u.email)}
                >
                  <img src={u.photo} alt={u.firstname} className="w-12 h-12 rounded-full object-cover border-2 border-[#7C3AED]/20" loading="lazy" referrerPolicy="no-referrer" />
                  <div>
                    <p className={`font-bold transition-colors ${isCurrentUserAdmin ? 'group-hover:text-[#7C3AED]' : ''}`}>{u.firstname} {u.lastname}</p>
                    <p className="text-xs text-gray-500">Online</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                </div>
              </div>
              
              <div className="flex flex-wrap gap-1.5 mb-1">
                {u.roles && u.roles.length > 0 ? (
                  u.roles
                    .sort((a, b) => (a === 'Administrador' ? -1 : b === 'Administrador' ? 1 : 0))
                    .map(role => (
                      <span key={role} className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${role === 'Administrador' ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-[#7C3AED]/20 text-[#D1AEFF] border-[#7C3AED]/30'}`}>
                        {role}
                      </span>
                    ))
                ) : (
                  <span className="text-[10px] text-gray-600 italic">Sem cargos atribuídos</span>
                )}
              </div>

              <AnimatePresence>
                {isCurrentUserAdmin && editingUserRoles === u.email && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 border-t border-white/5 mt-2">
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {AVAILABLE_ROLES.filter(role => role !== 'Administrador').map(role => (
                          <button
                            key={role}
                            onClick={() => toggleUserRole(u.email, role)}
                            className={`text-[10px] p-2 rounded-lg text-left transition-all border ${
                              u.roles?.includes(role) 
                                ? 'bg-[#7C3AED] text-white border-[#7C3AED]' 
                                : 'bg-white/5 text-gray-400 border-white/5 hover:bg-white/10'
                            }`}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                      <button 
                        onClick={() => setEditingUserRoles(null)}
                        className="w-full py-2 bg-[#7C3AED]/10 text-[#D1AEFF] text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-[#7C3AED]/20 transition-all border border-[#7C3AED]/20"
                      >
                        Concluir
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
});

interface ProductionDashboardProps {
  productionSteps: ProductionStep[];
  onSendMessage: (stepId: number, text: string) => void;
  onRemoveMessage: (stepId: number, messageId: string) => void;
  onAddContent: (stepId: number, content: any) => void;
  onUpdateContent: (stepId: number, contentId: string, updates: any) => void;
  onUpdateContentStatus: (stepId: number, contentId: string, status: any) => void;
  onRemoveContent: (stepId: number, contentId: string) => void;
  onSendToCalendar: (stepId: number, content: ProductionContent) => void | Promise<void>;
  currentUser: UserData;
  allUsers: UserData[];
}

const ProductionDashboard = React.memo(({
  productionSteps,
  onSendMessage,
  onRemoveMessage,
  onAddContent,
  onUpdateContent,
  onUpdateContentStatus,
  onRemoveContent,
  onSendToCalendar,
  currentUser,
  allUsers
}: ProductionDashboardProps) => {
  const [focusedStepId, setFocusedStepId] = React.useState<number | null>(null);

  // Clear focus when clicking outside grid
  React.useEffect(() => {
    const handleClick = () => setFocusedStepId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      <div className="mb-2" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl sm:text-2xl font-bold mb-1">Fluxo de Produção</h2>
        <p className="text-xs sm:text-sm text-gray-500">Acompanhe e gerencie o status de cada etapa de criação.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {productionSteps.map(step => (
        <ProductionCard 
          key={step.id} 
          step={step} 
          onSendMessage={onSendMessage}
          onRemoveMessage={onRemoveMessage}
          onAddContent={onAddContent}
          onUpdateContent={onUpdateContent}
          onUpdateContentStatus={onUpdateContentStatus}
          onRemoveContent={onRemoveContent}
          onSendToCalendar={(content) => onSendToCalendar(step.id, content)}
          allContents={Object.fromEntries(productionSteps.map(s => [s.id, s.contents || []]))}
          currentUser={currentUser}
          allUsers={allUsers}
          isFocused={focusedStepId === step.id}
          onFocus={(id) => setFocusedStepId(id)}
        />
      ))}
      </div>
    </div>
  );
});

const MetricsView = React.memo<{
  productionSteps: ProductionStep[];
  allContents: Record<number, ProductionContent[]>;
  scheduledTasks: ScheduledTask[];
  instagramMetrics: { followers: number; views: number; followersGoal: number };
  onUpdateInstagramMetrics: (followers: number, views: number, followersGoal: number) => Promise<void>;
  isAdmin: boolean;
}>(({ productionSteps, allContents, scheduledTasks, instagramMetrics, onUpdateInstagramMetrics, isAdmin }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editFollowers, setEditFollowers] = useState((instagramMetrics.followers ?? 0).toString());
  const [editViews, setEditViews] = useState((instagramMetrics.views ?? 0).toString());
  const [editFollowersGoal, setEditFollowersGoal] = useState((instagramMetrics.followersGoal ?? 0).toString());

  useEffect(() => {
    setEditFollowers((instagramMetrics.followers ?? 0).toString());
    setEditViews((instagramMetrics.views ?? 0).toString());
    setEditFollowersGoal((instagramMetrics.followersGoal ?? 0).toString());
  }, [instagramMetrics]);

  const handleSave = async () => {
    await onUpdateInstagramMetrics(
      parseInt(editFollowers) || 0, 
      parseInt(editViews) || 0,
      parseInt(editFollowersGoal) || 0
    );
    setIsEditing(false);
  };

  // Data processing
  const allContentsList = productionSteps.flatMap(s => s.contents || []);
  const totalContents = allContentsList.length;
  const doneContents = allContentsList.filter(c => c.status === 'done' || c.status === 'finalizado').length;
  const doingContents = allContentsList.filter(c => c.status === 'doing' || c.status === 'gravando' || c.status === 'editando').length;
  const todoContents = allContentsList.filter(c => c.status === 'todo').length;

  const stepData = productionSteps.map(step => ({
    name: step.title,
    concluido: (step.contents || []).filter(c => c.status === 'done' || c.status === 'finalizado').length,
    total: (step.contents || []).length
  }));

  const productivityData = React.useMemo(() => {
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    return last7Days.map(date => {
      const dayData: any = { date: date.split('-').reverse().slice(0, 2).join('/') };
      productionSteps.forEach(step => {
        dayData[step.title] = (step.contents || []).filter(c => (c.status === 'done' || c.status === 'finalizado') && c.completionDate === date).length;
      });
      return dayData;
    });
  }, [productionSteps]);

  const COLORS = ['#10B981', '#7C3AED', '#374151', '#F59E0B', '#3B82F6', '#EC4899'];

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      <div className="mb-2">
        <h2 className="text-xl sm:text-2xl font-bold mb-1">Métricas de Desempenho</h2>
        <p className="text-xs sm:text-sm text-gray-500">Análise de crescimento e produtividade da equipe.</p>
      </div>

      <div className="flex flex-col gap-8">
      {/* Instagram Metrics */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-[#181820] p-8 rounded-[32px] border border-white/5 relative overflow-hidden group">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Instagram</p>
              <h2 className="text-2xl font-bold text-white">Métricas de Alcance</h2>
            </div>
            {isAdmin && (
              <button 
                onClick={() => setIsEditing(!isEditing)}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-gray-400 hover:text-white"
              >
                {isEditing ? <X size={16} /> : <Edit2 size={16} />}
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Seguidores</label>
                  <input 
                    type="number"
                    value={editFollowers}
                    onChange={(e) => setEditFollowers(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-[#7C3AED]/50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Visualizações</label>
                  <input 
                    type="number"
                    value={editViews}
                    onChange={(e) => setEditViews(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-[#7C3AED]/50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase font-bold">Meta</label>
                  <input 
                    type="number"
                    value={editFollowersGoal}
                    onChange={(e) => setEditFollowersGoal(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-[#7C3AED]/50"
                  />
                </div>
              </div>
              <button 
                onClick={handleSave}
                className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold py-2 rounded-xl transition-colors"
              >
                Salvar Alterações
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-8">
              <div className="flex flex-col">
                <p className="text-4xl font-bold text-white mb-1">
                  {instagramMetrics.followers.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">Seguidores Totais</p>
              </div>
              <div className="flex flex-col">
                <p className="text-4xl font-bold text-white mb-1">
                  {instagramMetrics.views.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">Visualizações Totais</p>
              </div>
            </div>
          )}
          
          <div className="mt-8 pt-8 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Progresso da Meta</p>
              <span className="text-xs text-[#7C3AED] font-bold">
                {instagramMetrics.followersGoal > 0 
                  ? Math.round((instagramMetrics.followers / instagramMetrics.followersGoal) * 100) 
                  : 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#7C3AED] to-[#EC4899] transition-all duration-1000"
                style={{ width: `${Math.min(100, (instagramMetrics.followers / (instagramMetrics.followersGoal || 1)) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
              {instagramMetrics.followersGoal - instagramMetrics.followers > 0 
                ? `Faltam ${(instagramMetrics.followersGoal - instagramMetrics.followers).toLocaleString()} para bater a meta de ${instagramMetrics.followersGoal.toLocaleString()} seguidores.`
                : "Meta atingida! Parabéns!"}
            </p>
          </div>
        </div>
      </div>

      {/* Productivity Line Chart */}
      <div className="bg-[#181820] p-8 rounded-[32px] border border-white/5">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Desempenho</p>
            <h2 className="text-2xl font-bold text-white">Produtividade por Setor</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#10B981]" />
              <span className="text-[10px] text-gray-400 uppercase font-bold">Concluídos</span>
            </div>
          </div>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={productivityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#6B7280" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                dy={10}
              />
              <YAxis 
                stroke="#6B7280" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#181820', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  fontSize: '12px'
                }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend 
                verticalAlign="top" 
                height={36}
                iconType="circle"
                formatter={(value) => <span className="text-[10px] text-gray-400 uppercase font-bold ml-1">{value}</span>}
              />
              {productionSteps.map((step, idx) => (
                <Line 
                  key={step.id}
                  type="monotone" 
                  dataKey={step.title} 
                  stroke={COLORS[idx % COLORS.length]} 
                  strokeWidth={3}
                  dot={{ r: 4, strokeWidth: 2, fill: '#181820' }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-[#181820] p-6 rounded-[24px] border border-white/5 flex flex-col gap-2">
          <div className="w-10 h-10 bg-[#10B981]/10 rounded-xl flex items-center justify-center text-[#10B981] mb-2">
            <CheckCircle2 size={20} />
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Progresso Geral</p>
          <h3 className="text-3xl font-bold">{totalContents > 0 ? Math.round((doneContents / totalContents) * 100) : 0}%</h3>
          <p className="text-[10px] text-gray-600">{doneContents} de {totalContents} itens concluídos</p>
        </div>
        <div className="bg-[#181820] p-6 rounded-[24px] border border-white/5 flex flex-col gap-2">
          <div className="w-10 h-10 bg-[#7C3AED]/10 rounded-xl flex items-center justify-center text-[#7C3AED] mb-2">
            <Layers size={20} />
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Em Produção</p>
          <h3 className="text-3xl font-bold">{doingContents}</h3>
          <p className="text-[10px] text-gray-600">Itens sendo trabalhados</p>
        </div>
        <div className="bg-[#181820] p-6 rounded-[24px] border border-white/5 flex flex-col gap-2">
          <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-400 mb-2">
            <Clock size={20} />
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">A Fazer</p>
          <h3 className="text-3xl font-bold">{todoContents}</h3>
          <p className="text-[10px] text-gray-600">Itens aguardando início</p>
        </div>
        <div className="bg-[#181820] p-6 rounded-[24px] border border-white/5 flex flex-col gap-2">
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400 mb-2">
            <Calendar size={20} />
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Agendamentos</p>
          <h3 className="text-3xl font-bold">{scheduledTasks.length}</h3>
          <p className="text-[10px] text-gray-600">Tarefas no calendário</p>
        </div>
      </div>

      <div className="bg-[#181820] p-8 rounded-[32px] border border-white/5 flex flex-col gap-6 min-h-[400px]">
        <div>
          <h3 className="text-lg font-bold">Desempenho por Etapa</h3>
          <p className="text-xs text-gray-500">Comparativo de itens concluídos vs total.</p>
        </div>
        <div className="flex-1 min-h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stepData} layout="vertical" margin={{ left: 40, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="name" 
                type="category" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#9CA3AF', fontSize: 10 }}
                width={100}
              />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{ backgroundColor: '#181820', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Bar dataKey="concluido" fill="#10B981" radius={[0, 4, 4, 0]} barSize={12} name="Concluído" />
              <Bar dataKey="total" fill="rgba(255,255,255,0.05)" radius={[0, 4, 4, 0]} barSize={12} name="Total" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-[#181820] p-8 rounded-[32px] border border-white/5 flex flex-col gap-6">
        <div>
          <h3 className="text-lg font-bold">Atividade Recente</h3>
          <p className="text-xs text-gray-500">Últimos itens concluídos pela equipe.</p>
        </div>
        <div className="flex flex-col gap-3">
          {allContentsList
            .filter(c => (c.status === 'done' || c.status === 'finalizado') && c.completionDate)
            .sort((a, b) => new Date(b.completionDate!).getTime() - new Date(a.completionDate!).getTime())
            .slice(0, 5)
            .map(content => (
              <div key={content.id} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center text-green-500">
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{content.title}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      {productionSteps.find(s => (s.contents || []).some(c => c.id === content.id))?.title}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-600 italic">Concluído</p>
                </div>
              </div>
            ))}
          {allContentsList.filter(c => c.status === 'done' || c.status === 'finalizado').length === 0 && (
            <div className="py-12 flex flex-col items-center justify-center text-center opacity-40">
              <Activity size={40} className="mb-4" />
              <p className="text-sm italic">Nenhuma atividade registrada ainda.</p>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
});

function AppContent() {
  const [view, setView] = useState<View>('login');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('production');
  const [users, setUsers] = useState<UserData[]>([]);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [editingUserRoles, setEditingUserRoles] = useState<string | null>(null);

  const [productionSteps, setProductionSteps] = useState<ProductionStep[]>([]);
  const [allContents, setAllContents] = useState<Record<number, ProductionContent[]>>({});
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [instagramMetrics, setInstagramMetrics] = useState<{ followers: number; views: number; followersGoal: number }>({ followers: 0, views: 0, followersGoal: 0 });

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAdminPopupOpen, setIsAdminPopupOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [isAutoScheduleOpen, setIsAutoScheduleOpen] = useState(false);
  const [autoScheduleData, setAutoScheduleData] = useState<{stepId: number, content: ProductionContent} | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('12:00');
  const [verificationPassword, setVerificationPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isProfilePopupOpen, setIsProfilePopupOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [editFirstname, setEditFirstname] = useState('');
  const [editLastname, setEditLastname] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editConfirmPassword, setEditConfirmPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editProfileError, setEditProfileError] = useState('');
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [showEditConfirmPassword, setShowEditConfirmPassword] = useState(false);

  // Form states
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [createFirstname, setCreateFirstname] = useState('');
  const [createLastname, setCreateLastname] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirm, setCreateConfirm] = useState('');
  const [createPhoto, setCreatePhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [firstnameError, setFirstnameError] = useState(false);
  const [lastnameError, setLastnameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [loginNameError, setLoginNameError] = useState(false);
  const [loginPasswordError, setLoginPasswordError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loginErrorMessage, setLoginErrorMessage] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotErrorMessage, setForgotErrorMessage] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [membersTab, setMembersTab] = useState<'users'>('users');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  // Migration & Efficiency Refs
  const migrationRunRef = useRef(false);

  // Migration: Remove "admin" role and replace with "Administrador"
  useEffect(() => {
    if (!isAuthReady || !currentUser || users.length === 0 || migrationRunRef.current) return;
    
    const isCurrentUserAdmin = isUserAdmin(currentUser);
    if (!isCurrentUserAdmin) return;

    const usersToMigrate = users.filter(u => u.roles?.includes('admin'));
    if (usersToMigrate.length === 0) return;

    migrationRunRef.current = true;
    const runMigration = async () => {
      try {
        const batch = writeBatch(db);
        usersToMigrate.forEach(u => {
          if (!u.uid) return;
          const newRoles = (u.roles || []).filter(r => r !== 'admin');
          if (!newRoles.includes('Administrador')) {
            newRoles.unshift('Administrador');
          }
          batch.update(doc(db, 'users', u.uid), { roles: newRoles });
        });
        await batch.commit();
        console.log('Migration: Removed "admin" role and ensured "Administrador" role.');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'users_migration', false);
      }
    };

    runMigration();
  }, [isAuthReady, currentUser, users]);

  // Auto-verify admin if user already has the role in Firestore
  useEffect(() => {
    if (currentUser && currentUser.roles?.includes('Administrador')) {
      setIsAdminVerified(true);
    }
  }, [currentUser]);

  // Route Guard: Ensure user is logged in for dashboard
  useEffect(() => {
    if (isAuthReady) {
      if (view === 'dashboard' && !currentUser) {
        setView('login');
      } else if (currentUser && (view === 'login' || view === 'create' || view === 'forgot-password')) {
        setView('dashboard');
      }
    }
  }, [isAuthReady, view, currentUser]);

  const isCreatingAccountRef = useRef(false);

  // Auth & User Listener
  useEffect(() => {
    let unsubscribeUser: (() => void) | null = null;

    let unsubscribeNotifications: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeUser) {
        unsubscribeUser();
        unsubscribeUser = null;
      }
      if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
      }

      if (user) {
        // Real-time listener for current user document
        unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), async (userDoc) => {
          if (userDoc.exists()) {
            const userData = { ...userDoc.data(), uid: userDoc.id } as UserData;
            
            // Sincroniza e-mail verificado do Auth com o Firestore se houver divergência
            if (user.email && userData.email !== user.email) {
              updateDoc(doc(db, 'users', user.uid), { email: user.email })
                .catch(e => console.error('Error syncing email:', e));
              userData.email = user.email;
            }
            
            setCurrentUser(userData);
            setView(prev => prev === 'login' || prev === 'forgot-password' ? 'dashboard' : prev);

            // Set up notification listener for this user's roles
            if (!unsubscribeNotifications) {
              const q = query(
                collection(db, 'notifications'), 
                where('timestamp', '>', new Date().toISOString()),
                orderBy('timestamp', 'desc')
              );
              unsubscribeNotifications = onSnapshot(q, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                  if (change.type === 'added') {
                    const notif = change.doc.data() as AppNotification;
                    if (notif.targetRole && userData.roles?.includes(notif.targetRole)) {
                      setNotification({ message: notif.message, type: notif.type });
                    }
                  }
                });
              }, (error) => handleFirestoreError(error, OperationType.LIST, 'notifications'));
            }
          } else if (!isCreatingAccountRef.current) {
            // New user from Google Auth or missing profile
            const userData: UserData = {
              firstname: user.displayName?.split(' ')[0] || 'Usuário',
              lastname: user.displayName?.split(' ').slice(1).join(' ') || '',
              email: user.email || '',
              photo: user.photoURL || `https://picsum.photos/seed/${user.uid}/200/200`,
              roles: user.email === 'santosalexander97528@gmail.com' ? ['Administrador'] : []
            };
            try {
              await setDoc(doc(db, 'users', user.uid), userData);
              // The onSnapshot will trigger and set the state
            } catch (error) {
              handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
            }
          }
          setIsAuthReady(true);
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
          setIsAuthReady(true);
        });
      } else {
        setCurrentUser(null);
        setView('login');
        setIsAuthReady(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
      if (unsubscribeNotifications) unsubscribeNotifications();
    };
  }, []);

  // Other Firestore Listeners
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!isAuthReady || !userId || !currentUser) return;

    // Users Listener - Available for all authenticated users to see the member directory
    let unsubUsers: (() => void) | null = null;
    if (userId) {
      unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
        const usersList = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserData));
        setUsers(usersList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
    }

    // Production Steps Listener
    const unsubSteps = onSnapshot(collection(db, 'productionSteps'), (snapshot) => {
      if (snapshot.empty) {
        // Only admin can initialize
        if (isUserAdmin(currentUser)) {
          const initialSteps = [
            { id: 1, title: 'Copy', description: 'Criação de textos persuasivos e estratégicos.', status: 'doing' },
            { id: 2, title: 'Roteiro', description: 'Roteirização detalhada para vídeos e produções.', status: 'todo' },
            { id: 3, title: 'Criativo', description: 'Desenvolvimento de artes, layouts e identidade visual.', status: 'todo' },
            { id: 4, title: 'Captação', description: 'Gravação de conteúdo bruto e material audiovisual.', status: 'todo' },
            { id: 6, title: 'Edição', description: 'Pós-produção audiovisual e finalização de vídeos.', status: 'todo' },
          ];
          const batch = writeBatch(db);
          initialSteps.forEach(step => {
            batch.set(doc(db, 'productionSteps', step.id.toString()), step);
          });
          batch.commit().catch(e => handleFirestoreError(e, OperationType.WRITE, 'productionSteps'));
        }
      } else {
        const steps = snapshot.docs.map(doc => doc.data() as ProductionStep);
        
        // Migration: Remove Televisão if it exists
        if (isUserAdmin(currentUser)) {
          const step5 = steps.find(s => s.id === 5);
          if (step5) {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'productionSteps', '5'));
            batch.commit().catch(e => handleFirestoreError(e, OperationType.WRITE, 'productionSteps'));
          }
        }

        // Migration: Split Captação & Edição if they are still combined
        if (isUserAdmin(currentUser)) {
          const step4 = steps.find(s => s.id === 4);
          if (step4 && step4.title === 'Captação & Edição') {
            const batch = writeBatch(db);
            batch.update(doc(db, 'productionSteps', '4'), {
              title: 'Captação',
              description: 'Gravação de conteúdo bruto e material audiovisual.'
            });
            if (!steps.find(s => s.id === 6)) {
              batch.set(doc(db, 'productionSteps', '6'), {
                id: 6,
                title: 'Edição',
                description: 'Pós-produção audiovisual e finalização de vídeos.',
                status: 'todo'
              });
            }
            batch.commit().catch(e => handleFirestoreError(e, OperationType.WRITE, 'productionSteps'));
          }
        }

        setProductionSteps(steps.sort((a, b) => a.id - b.id));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'productionSteps');
    });

    // Scheduled Tasks Listener
    const unsubTasks = onSnapshot(collection(db, 'scheduledTasks'), (snapshot) => {
      const tasks = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ScheduledTask));
      setScheduledTasks(tasks);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'scheduledTasks'));

    // Instagram Metrics Listener
    const unsubMetrics = onSnapshot(doc(db, 'settings', 'instagramMetrics'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setInstagramMetrics({
          followers: data.followers ?? 0,
          views: data.views ?? 0,
          followersGoal: data.followersGoal ?? 0
        });
      } else if (isUserAdmin(currentUser)) {
        setDoc(doc(db, 'settings', 'instagramMetrics'), { followers: 0, views: 0, followersGoal: 0 })
          .catch(e => handleFirestoreError(e, OperationType.WRITE, 'settings/instagramMetrics'));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/instagramMetrics');
    });

    // Contents Listeners for all steps
    const unsubContentsList: (() => void)[] = [];
    [1, 2, 3, 4, 6].forEach(stepId => {
      const unsub = onSnapshot(
        collection(db, `productionSteps/${stepId}/contents`),
        (snapshot) => {
          const contents = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as ProductionContent));
          setAllContents(prev => ({ ...prev, [stepId]: contents }));
        },
        (error) => handleFirestoreError(error, OperationType.LIST, `productionSteps/${stepId}/contents`)
      );
      unsubContentsList.push(unsub);
    });

    return () => {
      if (unsubUsers) unsubUsers();
      unsubSteps();
      unsubTasks();
      unsubMetrics();
      unsubContentsList.forEach(unsub => unsub());
    };
  }, [isAuthReady, auth.currentUser?.uid, currentUser, isAdminVerified]);

  const mergedSteps = React.useMemo(() => {
    return productionSteps.map(step => ({
      ...step,
      contents: allContents[step.id] || []
    }));
  }, [productionSteps, allContents]);

  const toggleUserRole = React.useCallback(async (email: string, role: string) => {
    if (role === 'Administrador') return; // Cannot toggle Administrador role manually
    
    const userToUpdate = users.find(u => u.email === email);
    if (!userToUpdate || !userToUpdate.uid) return;

    const userUid = userToUpdate.uid;
    const currentRoles = userToUpdate.roles || [];
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter(r => r !== role)
      : [...currentRoles, role];

    try {
      await updateDoc(doc(db, 'users', userUid), { roles: newRoles });
      
      // Also update currentUser if it's the same person
      if (currentUser && currentUser.email === email) {
        setCurrentUser({ ...currentUser, roles: newRoles });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userUid}`);
    }
  }, [users, currentUser]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('login');
      setIsSidebarOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.AUTH, 'logout', false);
    }
  };

  // Reset forms when switching views
  React.useEffect(() => {
    setLoginName('');
    setLoginPassword('');
    setCreateFirstname('');
    setCreateLastname('');
    setCreateEmail('');
    setCreatePassword('');
    setCreateConfirm('');
    setCreatePhoto(null);
    setPhotoPreview(null);
    setPhotoError(false);
    setPasswordError(false);
    setConfirmError(false);
    setFirstnameError(false);
    setLastnameError(false);
    setEmailError(false);
    setLoginNameError(false);
    setLoginPasswordError(false);
    setErrorMessage('');
    setLoginErrorMessage('');
    setForgotEmail('');
    setForgotErrorMessage('');
    setForgotSuccess(false);
  }, [view]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ADMIN_PASSWORD = "MKTFTC2026#";

  const handleCreateAccount = async () => {
    // Reset errors
    setPhotoError(false);
    setPasswordError(false);
    setConfirmError(false);
    setFirstnameError(false);
    setLastnameError(false);
    setEmailError(false);
    setErrorMessage('');

    let hasEmpty = false;
    if (!createFirstname) { setFirstnameError(true); hasEmpty = true; }
    if (!createLastname) { setLastnameError(true); hasEmpty = true; }
    if (!createEmail) { setEmailError(true); hasEmpty = true; }
    if (!createPassword) { setPasswordError(true); hasEmpty = true; }
    if (!createConfirm) { setConfirmError(true); hasEmpty = true; }

    if (hasEmpty) {
      setErrorMessage('Preencha todos os campos!');
      return;
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createEmail)) {
      setEmailError(true);
      setErrorMessage('Insira um e-mail válido!');
      return;
    }

    if (createPassword.length < 8) {
      setPasswordError(true);
      setErrorMessage("A senha precisa conter pelo menos 8 caracteres.");
      return;
    }

    if (createPassword !== createConfirm) {
      setConfirmError(true);
      setErrorMessage("Senhas não coincidem!");
      return;
    }

    // Password validation: must contain at least one letter
    if (!/[a-zA-Z]/.test(createPassword)) {
      setPasswordError(true);
      setErrorMessage('A senha deve conter pelo menos uma letra!');
      return;
    }

    setIsCreatingAccount(true);
    isCreatingAccountRef.current = true;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, createEmail, createPassword);
      const user = userCredential.user;

      const photoURL = photoPreview || `https://picsum.photos/seed/${user.uid}/200/200`;

      const newUser: UserData = {
        firstname: createFirstname,
        lastname: createLastname,
        email: createEmail,
        photo: photoURL,
        roles: [],
      };

      await setDoc(doc(db, 'users', user.uid), newUser);
      
      setCurrentUser({ ...newUser, uid: user.uid });
      setView('dashboard');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.AUTH, 'create-account', false);
      if (error.code === 'auth/email-already-in-use') {
        setEmailError(true);
        setErrorMessage('Este e-mail já está em uso!');
      } else if (error.code === 'auth/operation-not-allowed') {
        setErrorMessage('O login com e-mail/senha não está habilitado no console do Firebase.');
      } else if (error.code === 'auth/weak-password') {
        setPasswordError(true);
        setErrorMessage('A senha é muito fraca.');
      } else {
        setErrorMessage('Erro ao criar conta. Tente novamente.');
      }
    } finally {
      setIsCreatingAccount(false);
      isCreatingAccountRef.current = false;
    }
  };

  const handleLogin = async () => {
    setLoginNameError(false);
    setLoginPasswordError(false);
    setLoginErrorMessage('');

    if (!loginName || !loginPassword) {
      if (!loginName) setLoginNameError(true);
      if (!loginPassword) setLoginPasswordError(true);
      setLoginErrorMessage('Preencha todos os campos!');
      return;
    }

    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginName, loginPassword);
      // onAuthStateChanged will handle the rest
    } catch (error: any) {
      handleFirestoreError(error, OperationType.AUTH, 'login', false);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginErrorMessage("O login com e-mail/senha não está habilitado no console do Firebase.");
      } else {
        setLoginErrorMessage("E-mail ou senha inválidos!");
        setLoginNameError(true);
        setLoginPasswordError(true);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleForgotPassword = async () => {
    setForgotErrorMessage('');
    setForgotSuccess(false);

    if (!forgotEmail) {
      setForgotErrorMessage('Por favor, insira seu e-mail.');
      return;
    }

    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      setForgotSuccess(true);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.AUTH, 'reset-password', false);
      if (error.code === 'auth/user-not-found') {
        setForgotErrorMessage('E-mail não encontrado em nossa base.');
      } else {
        setForgotErrorMessage('Erro ao enviar e-mail. Verifique o endereço e tente novamente.');
      }
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleAdminLogin = async () => {
    if (verificationPassword === ADMIN_PASSWORD) {
      // Automatically grant admin role if they don't have it in Firestore
      if (currentUser && !currentUser.roles?.includes('Administrador')) {
        try {
          const newRoles = [...(currentUser.roles || []), 'Administrador'];
          const userUid = currentUser.uid || auth.currentUser?.uid;
          if (!userUid) throw new Error("User ID not found");
          
          await updateDoc(doc(db, 'users', userUid), { roles: newRoles });
          setNotification({ message: "Cargo de Administrador concedido!", type: 'success' });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser?.uid || auth.currentUser?.uid}`);
        }
      }
      
      setIsAdminPanelOpen(true);
      setIsAdminPopupOpen(false);
      setIsAdminVerified(true);
      setVerificationPassword('');
    } else {
      setNotification({ message: "Senha incorreta!", type: 'error' });
    }
  };

  const openProfileEdit = () => {
    if (currentUser) {
      setEditFirstname(currentUser.firstname);
      setEditLastname(currentUser.lastname);
      setEditEmail(currentUser.email);
      setIsChangingPassword(false);
      setEditPassword('');
      setEditConfirmPassword('');
      setEditPhoto(null);
      setEditPhotoPreview(currentUser.photo);
      setIsProfilePopupOpen(true);
    }
  };

  const handleUpdateProfile = async () => {
    if (!currentUser || !auth.currentUser) return;
    setEditProfileError('');

    if (!editFirstname || !editLastname || !editEmail) {
      setEditProfileError('Preencha todos os campos!');
      return;
    }

    const emailChanged = editEmail.toLowerCase().trim() !== currentUser.email.toLowerCase().trim();

    const { password: _, uid, ...updatedUser } = {
      ...currentUser,
      firstname: editFirstname,
      lastname: editLastname,
      email: currentUser.email, 
      photo: editPhotoPreview || currentUser.photo
    } as any;

    try {
      const userUid = auth.currentUser.uid;
      
      // 1. Primeiro as atualizações básicas no Firestore (Nome, Sobrenome, Foto)
      await updateDoc(doc(db, 'users', userUid), updatedUser);
      
      // 2. Se a senha mudou
      if (isChangingPassword && editPassword) {
        if (editPassword.length < 8) {
          setEditProfileError("Mínimo 8 caracteres.");
          return;
        }
        if (editPassword !== editConfirmPassword) {
          setEditProfileError("Senhas não coincidem!");
          return;
        }
        await updatePassword(auth.currentUser, editPassword);
      }

      // 3. Se o e-mail mudou, solicitamos a verificação
      if (emailChanged) {
        try {
          await verifyBeforeUpdateEmail(auth.currentUser, editEmail.toLowerCase().trim());
          setNotification({ 
            message: "Enviamos um link de confirmação para seu novo e-mail. A alteração será concluída no sistema após você clicar no link enviado.", 
            type: 'warning' 
          });
        } catch (authError: any) {
          if (authError.code === 'auth/requires-recent-login') {
            setEditProfileError("Re-autenticação necessária.");
            setNotification({ message: "Para alterar o e-mail, você precisa ter feito login recentemente. Por favor, saia e entre novamente.", type: 'error' });
            return;
          }
          throw authError; // Repassa outros erros pro catch principal
        }
      } else {
        setNotification({ message: "Perfil atualizado com sucesso!", type: 'success' });
      }

      // Atualizamos o estado local com os dados novos (exceto e-mail que depende da verificação)
      setCurrentUser({ ...updatedUser, uid: userUid });
      setIsProfilePopupOpen(false);
      setIsChangingPassword(false);
      setEditPassword('');
      setEditConfirmPassword('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser.uid}`, false);
      if (error.code === 'auth/requires-recent-login') {
        setEditProfileError("Re-autenticação necessária.");
        setNotification({ message: "Para fazer essa alteração, você precisa ter feito login recentemente. Por favor, saia e entre novamente.", type: 'error' });
      } else if (error.code === 'auth/invalid-email') {
        setEditProfileError("E-mail inválido.");
      } else {
        setEditProfileError("Erro ao atualizar perfil.");
      }
    }
  };

  const sendMessage = React.useCallback(async (stepId: number, text: string) => {
    if (!text.trim() || !currentUser || !auth.currentUser) return;
    
    // Permission check
    if (!checkUserPermission(currentUser, stepId)) {
      setNotification({ message: "Você não tem permissão para enviar mensagens nesta etapa.", type: 'error' });
      return;
    }

    const messageId = doc(collection(db, `productionSteps/${stepId}/messages`)).id;
    const newMessage: ChatMessage = {
      id: messageId,
      user: `${currentUser.firstname} ${currentUser.lastname}`,
      photo: currentUser.photo,
      text: text,
      timestamp: new Date().toISOString(),
      userId: auth.currentUser.uid
    };

    try {
      await setDoc(doc(db, `productionSteps/${stepId}/messages`, messageId), newMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `productionSteps/${stepId}/messages/${messageId}`);
    }
  }, [currentUser]);

  const removeMessage = React.useCallback(async (stepId: number, messageId: string) => {
    if (!currentUser || !auth.currentUser) return;
    
    try {
      await deleteDoc(doc(db, `productionSteps/${stepId}/messages`, messageId));
      setNotification({ message: "Mensagem apagada com sucesso.", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `productionSteps/${stepId}/messages/${messageId}`);
    }
  }, [currentUser]);

  const addStepContent = React.useCallback(async (stepId: number, content: Omit<ProductionContent, 'id' | 'timestamp' | 'status'>) => {
    if (!currentUser) return;
    
    // Permission check
    if (!checkUserPermission(currentUser, stepId)) {
      setNotification({ message: "Você não tem permissão para adicionar conteúdo nesta etapa.", type: 'error' });
      return;
    }

    const contentId = doc(collection(db, `productionSteps/${stepId}/contents`)).id;
    const newContent: ProductionContent = {
      ...content,
      id: contentId,
      timestamp: new Date().toISOString(),
      status: 'todo',
      sentToNext: false
    };

    try {
      await setDoc(doc(db, `productionSteps/${stepId}/contents`, contentId), cleanObject(newContent));
      
      // Update step status if needed
      const step = productionSteps.find(s => s.id === stepId);
      if (step && step.status === 'done') {
        await updateDoc(doc(db, 'productionSteps', step.id.toString()), { status: 'doing' });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `productionSteps/${stepId}/contents/${contentId}`);
    }
  }, [productionSteps, currentUser]);

  const updateStepContent = React.useCallback(async (stepId: number, contentId: string, updates: Partial<ProductionContent>) => {
    if (!currentUser) return;
    
    // Permission check
    if (!checkUserPermission(currentUser, stepId)) {
      setNotification({ message: "Você não tem permissão para atualizar conteúdo nesta etapa.", type: 'error' });
      return;
    }

    try {
      await updateDoc(doc(db, `productionSteps/${stepId}/contents`, contentId), cleanObject(updates));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `productionSteps/${stepId}/contents/${contentId}`);
    }
  }, [currentUser]);

  const sendAppNotification = React.useCallback(async (message: string, targetRole: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    try {
      const id = doc(collection(db, 'notifications')).id;
      await setDoc(doc(db, 'notifications', id), {
        id,
        message,
        targetRole,
        type,
        timestamp: new Date().toISOString(),
        read: false,
        userId: auth.currentUser?.uid || 'system'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notifications');
    }
  }, []);

  const updateContentStatus = React.useCallback(async (stepId: number, contentId: string, newStatus: string) => {
    if (!currentUser) return;
    
    // Permission check
    if (!checkUserPermission(currentUser, stepId)) {
      setNotification({ message: "Você não tem permissão para alterar o status nesta etapa.", type: 'error' });
      return;
    }

    try {
      const currentContent = (allContents[stepId] || []).find(c => c.id === contentId);
      if (!currentContent) return;

      const oldStatus = currentContent.status;
      const isCompleting = newStatus === 'done' || newStatus === 'finalizado';

      // Validation Rules
      if (isCompleting) {
        if (stepId === 2) { // Roteiro
          if (!currentContent.fileLink || !currentContent.fileLink.includes('drive.google.com')) {
            setNotification({ message: "É obrigatório anexar o link do Google Drive para o roteiro em PDF.", type: 'error' });
            return;
          }
        } else if (stepId === 3) { // Criativo
          if (!currentContent.fileLink || currentContent.fileLink.trim() === '') {
            setNotification({ message: "Por favor, anexe o arquivo da arte antes de concluir.", type: 'error' });
            return;
          }
        } else if (stepId === 4) { // Captação
          if (!currentContent.fileLink || currentContent.fileLink.trim() === '') {
            setNotification({ message: "É obrigatório anexar pelo menos um arquivo de vídeo bruto antes da conclusão.", type: 'error' });
            return;
          }
        } else if (stepId === 6) { // Edição
          if (!currentContent.fileLink || currentContent.fileLink.trim() === '') {
            setNotification({ message: "É obrigatório anexar o vídeo final antes de concluir a edição.", type: 'error' });
            return;
          }
        }
      }

      const logEntry = {
        action: `Status alterado de ${oldStatus} para ${newStatus}`,
        user: `${currentUser.firstname} ${currentUser.lastname}`,
        timestamp: new Date().toISOString()
      };

      const updates: any = { 
        status: newStatus,
        logs: [...(currentContent.logs || []), logEntry]
      };

      if (isCompleting) {
        updates.completionDate = new Date().toISOString().split('T')[0];
        if (stepId === 3 || stepId === 6) {
          updates.readyForCalendar = true;
        }
      } else {
        updates.completionDate = null;
      }
      
      await updateDoc(doc(db, `productionSteps/${stepId}/contents`, contentId), updates);

      // Automation logic
      const wasDone = oldStatus === 'done' || oldStatus === 'finalizado';

      if (isCompleting && !wasDone && !currentContent.sentToNext) {
        if (stepId === 3 || stepId === 6) {
          // Auto-schedule popup
          setAutoScheduleData({ stepId, content: currentContent });
          setIsAutoScheduleOpen(true);
        }

        let sent = false;
        let nextStepId = 0;
        let nextRole = '';
        let nextMessage = '';

        if (stepId === 1) { // Copy -> Criativo (3)
          nextStepId = 3;
          nextRole = 'Criativo';
          nextMessage = `Nova tarefa de Copy: ${currentContent.title}`;
        } else if (stepId === 2) { // Roteiro -> Captação (4)
          nextStepId = 4;
          nextRole = 'Captação';
          nextMessage = `Novo roteiro para produção: ${currentContent.title}`;
        } else if (stepId === 4) { // Captação -> Edição (6)
          nextStepId = 6;
          nextRole = 'Edição';
          nextMessage = `Material bruto disponível para edição: ${currentContent.title}`;
        }

        if (nextStepId > 0) {
          const newId = doc(collection(db, `productionSteps/${nextStepId}/contents`)).id;
          const newContentData: any = {
            id: newId,
            title: currentContent.title,
            description: currentContent.description,
            fileLink: currentContent.fileLink,
            type: currentContent.type,
            timestamp: new Date().toISOString(),
            status: 'todo',
            sentToNext: false,
            sourceStepId: stepId,
            sourceContentId: currentContent.id,
            logs: [{
              action: `Recebido da etapa ${stepId}`,
              user: 'Sistema',
              timestamp: new Date().toISOString()
            }]
          };
          
          await setDoc(doc(db, `productionSteps/${nextStepId}/contents`, newId), cleanObject(newContentData));
          sent = true;
          await sendAppNotification(nextMessage, nextRole, 'info');
        }

        if (sent) {
          await updateDoc(doc(db, `productionSteps/${stepId}/contents`, contentId), { 
            sentToNext: true,
            logs: [...(updates.logs || []), {
              action: `Enviado para a próxima etapa`,
              user: 'Sistema',
              timestamp: new Date().toISOString()
            }]
          });
          setNotification({ message: "Conteúdo enviado com sucesso!", type: 'success' });
        }
      }

      // Recalculate step status
      const step = productionSteps.find(s => s.id === stepId);
      if (step) {
        const updatedContents = (allContents[stepId] || []).map(c => c.id === contentId ? { ...c, status: newStatus as any } : c);
        let overallStatus: 'todo' | 'doing' | 'done' = 'todo';
        if (updatedContents.length > 0) {
          const allDone = updatedContents.every(c => c.status === 'done' || c.status === 'finalizado');
          const someStarted = updatedContents.some(c => c.status !== 'todo');
          if (allDone) overallStatus = 'done';
          else if (someStarted) overallStatus = 'doing';
        }
        
        if (overallStatus !== step.status) {
          await updateDoc(doc(db, 'productionSteps', stepId.toString()), { status: overallStatus });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `productionSteps/${stepId}/contents/${contentId}`);
    }
  }, [allContents, productionSteps, currentUser, sendAppNotification]);

  const sendToCalendar = React.useCallback(async (stepId: number, content: ProductionContent) => {
    if (!currentUser) return;
    
    // Permission check
    if (!checkUserPermission(currentUser, stepId)) {
      setNotification({ message: "Você não tem permissão para enviar ao calendário nesta etapa.", type: 'error' });
      return;
    }

    // Validation: Only Criativo (3) or Edição (6)
    if (stepId !== 3 && stepId !== 6) {
      setNotification({ message: "Apenas conteúdos dos setores Criativo ou Edição podem ser enviados ao calendário.", type: 'error' });
      return;
    }

    // Validation: Content must be ready
    if (!content.readyForCalendar) {
      setNotification({ message: "O conteúdo deve estar marcado como 'Pronto para publicação' antes de ser enviado ao calendário.", type: 'error' });
      return;
    }

    // Validation: Prevent duplications
    const isDuplicate = scheduledTasks.some(t => t.taskReferenceId === content.id);
    if (isDuplicate) {
      setNotification({ message: "Este conteúdo já foi adicionado ao calendário.", type: 'error' });
      return;
    }

    // Description Logic
    let finalDescription = '';
    if (stepId === 3) {
      // Auto from Copy (1)
      finalDescription = content.description || `Postagem de: ${content.title}`;
    } else if (stepId === 6) {
      // Manual based on script - we'll prompt or use description if provided
      // For now, if description is empty, we'll ask for it in the UI or use a placeholder
      // But the requirement says "obrigatoriamente preenchida manualmente"
      if (!content.description || content.description.trim() === '') {
        setNotification({ message: "A descrição deve ser preenchida manualmente para conteúdos de Edição.", type: 'error' });
        return;
      }
      finalDescription = content.description;
    }

    try {
      const taskId = doc(collection(db, 'scheduledTasks')).id;
      const logEntry = {
        action: `Adicionado ao calendário a partir da etapa ${stepId}`,
        user: `${currentUser.firstname} ${currentUser.lastname}`,
        timestamp: new Date().toISOString()
      };

      await setDoc(doc(db, 'scheduledTasks', taskId), cleanObject({
        id: taskId,
        stepId,
        contentId: content.id,
        contentTitle: content.title,
        date: new Date().toISOString().split('T')[0],
        time: "12:00",
        description: finalDescription,
        status: 'Agendado',
        type: stepId === 3 ? 'arte' : 'vídeo',
        finalFileLink: content.fileLink,
        originStepId: stepId,
        taskReferenceId: content.id,
        logs: [logEntry]
      }));

      await updateDoc(doc(db, `productionSteps/${stepId}/contents`, content.id), { 
        sentToNext: true,
        logs: [...(content.logs || []), {
          action: `Enviado para o calendário`,
          user: `${currentUser.firstname} ${currentUser.lastname}`,
          timestamp: new Date().toISOString()
        }]
      });
      
      setNotification({ message: "Conteúdo agendado com sucesso!", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scheduledTasks');
    }
  }, [currentUser, scheduledTasks]);

  const removeStepContent = React.useCallback(async (stepId: number, contentId: string) => {
    if (!isUserAdmin(currentUser)) {
      setNotification({ message: "Apenas Administradores podem excluir conteúdos.", type: 'error' });
      return;
    }

    try {
      await deleteDoc(doc(db, `productionSteps/${stepId}/contents`, contentId));
      
      // Recalculate step status
      const step = productionSteps.find(s => s.id === stepId);
      if (step) {
        const updatedContents = (allContents[stepId] || []).filter(c => c.id !== contentId);
        let overallStatus: 'todo' | 'doing' | 'done' = 'todo';
        if (updatedContents.length > 0) {
          const allDone = updatedContents.every(c => c.status === 'done');
          const someStarted = updatedContents.some(c => c.status === 'doing' || c.status === 'done');
          if (allDone) overallStatus = 'done';
          else if (someStarted) overallStatus = 'doing';
        }
        
        if (overallStatus !== step.status) {
          await updateDoc(doc(db, 'productionSteps', stepId.toString()), { status: overallStatus });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `productionSteps/${stepId}/contents/${contentId}`);
    }
  }, [productionSteps, allContents]);

  const addScheduledTask = React.useCallback(async (task: Omit<ScheduledTask, 'id'>) => {
    if (!currentUser) return;

    // Duplicate check
    if (task.contentId && scheduledTasks.some(t => t.contentId === task.contentId)) {
      setNotification({ message: "Este conteúdo já está agendado no calendário.", type: 'warning' });
      return;
    }

    const taskId = doc(collection(db, 'scheduledTasks')).id;
    const logEntry = {
      action: `Agendamento criado manualmente`,
      user: `${currentUser.firstname} ${currentUser.lastname}`,
      timestamp: new Date().toISOString()
    };

    const newTask: ScheduledTask = {
      ...task,
      id: taskId,
      logs: [logEntry]
    };
    try {
      await setDoc(doc(db, 'scheduledTasks', taskId), cleanObject(newTask));
      setNotification({ message: "Agendamento criado com sucesso!", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `scheduledTasks/${taskId}`);
    }
  }, [currentUser]);

  const updateScheduledTask = React.useCallback(async (id: string, updates: Partial<ScheduledTask>) => {
    if (!currentUser) return;
    try {
      const taskRef = doc(db, 'scheduledTasks', id);
      const taskDoc = scheduledTasks.find(t => t.id === id);
      
      const logEntry = {
        action: `Agendamento atualizado: ${Object.keys(updates).join(', ')}`,
        user: `${currentUser.firstname} ${currentUser.lastname}`,
        timestamp: new Date().toISOString()
      };

      const newLogs = [...(taskDoc?.logs || []), logEntry];
      await updateDoc(taskRef, cleanObject({ ...updates, logs: newLogs }));
      setNotification({ message: "Agendamento atualizado!", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `scheduledTasks/${id}`);
    }
  }, [currentUser, scheduledTasks]);

  const removeScheduledTask = React.useCallback(async (id: string) => {
    if (!isUserAdmin(currentUser)) {
      setNotification({ message: "Apenas Administradores podem remover agendamentos.", type: 'error' });
      return;
    }

    try {
      await deleteDoc(doc(db, 'scheduledTasks', id));
      setNotification({ message: "Agendamento removido do calendário.", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `scheduledTasks/${id}`);
    }
  }, [currentUser]);

  const clearAllContents = React.useCallback(async () => {
    if (!isUserAdmin(currentUser)) {
      setNotification({ message: "Apenas Administradores podem limpar conteúdos.", type: 'error' });
      return;
    }
    setIsClearConfirmOpen(true);
  }, [currentUser]);

  const executeClearAll = React.useCallback(async () => {
    setIsClearConfirmOpen(false);
    setNotification({ message: "Limpando conteúdos...", type: 'info' });

    try {
      const batch = writeBatch(db);
      for (const stepId of [1, 2, 3, 4, 6]) {
        const contents = allContents[stepId] || [];
        contents.forEach(content => {
          batch.delete(doc(db, `productionSteps/${stepId}/contents`, content.id));
        });
        // Reset step status to todo
        batch.update(doc(db, 'productionSteps', stepId.toString()), { status: 'todo' });
      }
      await batch.commit();
      setNotification({ message: "Todos os conteúdos foram excluídos com sucesso!", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'all_contents');
    }
  }, [allContents]);

  const updateInstagramMetrics = React.useCallback(async (followers: number, views: number, followersGoal: number) => {
    try {
      await setDoc(doc(db, 'settings', 'instagramMetrics'), { followers, views, followersGoal });
      setNotification({ message: "Métricas do Instagram atualizadas!", type: 'success' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/instagramMetrics');
    }
  }, []);

  if (!isAuthReady) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-[#0F0F14]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-[#7C3AED] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (view === 'dashboard' && currentUser) {
    return (
      <div className="flex flex-col w-full h-screen bg-[#0F0F14]">
        {/* HEADER */}
        <header className="h-[60px] bg-[#181820] border-b border-white/5 flex items-center justify-between px-5 z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <Menu size={24} />
            </button>
            <h1 className="text-lg font-bold flex items-center">
              <span className="text-white">Fatec</span>
              <span className="text-[#7C3AED] ml-1">Social</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <p className="text-sm font-medium">{currentUser.firstname} {currentUser.lastname}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                {isUserAdmin(currentUser) ? 'Administrador' : (currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles.join(', ') : 'Membro')}
              </p>
            </div>
            <div 
              onClick={openProfileEdit}
              className="w-[40px] h-[40px] rounded-full bg-[#30303A] border border-[#7C3AED]/50 cursor-pointer hover:scale-105 transition-transform overflow-hidden"
            >
              <img 
                src={currentUser.photo} 
                alt="Profile" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            </div>
          </div>
        </header>

        <div className="flex flex-1 relative overflow-hidden">
          <Sidebar 
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            dashboardTab={dashboardTab}
            setDashboardTab={(tab: any) => setDashboardTab(tab)}
            isAdminPanelOpen={isAdminPanelOpen}
            setIsAdminPanelOpen={setIsAdminPanelOpen}
            isAdminVerified={isAdminVerified}
            onLogout={() => {
              setCurrentUser(null);
              setView('login');
              setIsSidebarOpen(false);
              setIsAdminVerified(false);
              setIsAdminPanelOpen(false);
            }}
          />

          {/* MAIN CONTENT */}
          <main className={`flex-1 p-6 pb-12 overflow-x-auto transition-all duration-300 ${isSidebarOpen ? 'md:ml-[260px]' : ''}`}>
            {!isAuthReady ? (
              <div className="flex items-center justify-center h-full">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-10 h-10 border-4 border-[#7C3AED] border-t-transparent rounded-full"
                />
              </div>
            ) : isAdminPanelOpen ? (
              <AdminPanel 
                membersTab={membersTab}
                setMembersTab={(tab: any) => setMembersTab(tab)}
                users={users}
                editingUserRoles={editingUserRoles}
                setEditingUserRoles={setEditingUserRoles}
                AVAILABLE_ROLES={AVAILABLE_ROLES}
                toggleUserRole={toggleUserRole}
                currentUser={currentUser}
                setIsAdminPopupOpen={setIsAdminPopupOpen}
                isAdminVerified={isAdminVerified}
                verificationPassword={verificationPassword}
                setVerificationPassword={setVerificationPassword}
                handleAdminLogin={handleAdminLogin}
                onClearAllContents={clearAllContents}
              />
            ) : dashboardTab === 'production' ? (
              <ProductionDashboard 
                productionSteps={mergedSteps}
                onSendMessage={sendMessage}
                onRemoveMessage={removeMessage}
                onAddContent={addStepContent}
                onUpdateContent={updateStepContent}
                onUpdateContentStatus={updateContentStatus}
                onRemoveContent={removeStepContent}
                onSendToCalendar={sendToCalendar}
                currentUser={currentUser}
                allUsers={users}
              />
            ) : dashboardTab === 'calendar' ? (
              <CalendarView 
                productionSteps={mergedSteps}
                scheduledTasks={scheduledTasks}
                onAddScheduledTask={addScheduledTask}
                onUpdateScheduledTask={updateScheduledTask}
                onRemoveScheduledTask={removeScheduledTask}
                currentUser={currentUser!}
              />
            ) : (
              <MetricsView 
                productionSteps={mergedSteps}
                allContents={allContents}
                scheduledTasks={scheduledTasks}
                instagramMetrics={instagramMetrics}
                onUpdateInstagramMetrics={updateInstagramMetrics}
                isAdmin={isUserAdmin(currentUser)}
              />
            )}
          </main>
        </div>

        {/* NOTIFICATION */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl shadow-2xl border flex items-center gap-3 min-w-[300px] ${
                notification.type === 'success' 
                  ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                  : notification.type === 'error'
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : notification.type === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
              }`}
            >
              {notification.type === 'success' ? <CheckCircle2 size={20} /> : 
               notification.type === 'error' ? <AlertCircle size={20} /> :
               notification.type === 'warning' ? <AlertTriangle size={20} /> :
               <Activity size={20} />}
              <p className="text-sm font-medium">{notification.message}</p>
              <button 
                onClick={() => setNotification(null)}
                className="ml-auto p-1 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
              <motion.div 
                initial={{ width: '100%' }}
                animate={{ width: 0 }}
                transition={{ duration: 5, ease: 'linear' }}
                onAnimationComplete={() => setNotification(null)}
                className={`absolute bottom-0 left-0 h-1 ${notification.type === 'success' ? 'bg-green-500/50' : 'bg-red-500/50'}`}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ADMIN POPUP */}
        <AnimatePresence>
          {isAdminPopupOpen && (
            <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-5 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#181820] p-8 rounded-[24px] text-center w-full max-w-[340px] shadow-2xl border border-white/10"
              >
                <div className="w-16 h-16 bg-[#7C3AED]/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Shield size={32} className="text-[#7C3AED]" />
                </div>
                <h2 className="text-xl font-bold mb-2">Acesso de Administrador</h2>
                <p className="text-xs text-gray-500 mb-6">Digite a senha de Administrador para gerenciar os membros.</p>
                <input 
                  type="password" 
                  placeholder="Código de Administrador"
                  className="input-field mb-4 text-center"
                  value={verificationPassword}
                  onChange={(e) => setVerificationPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                />
                <div className="flex flex-col gap-2">
                  <button onClick={handleAdminLogin} className="primary-btn w-full">Validar Acesso</button>
                  <button onClick={() => { setIsAdminPopupOpen(false); setVerificationPassword(''); }} className="text-xs text-gray-500 hover:text-white transition-colors mt-2">Cancelar</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* CLEAR CONTENTS CONFIRMATION POPUP */}
        <AnimatePresence>
          {isClearConfirmOpen && (
            <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[60] p-5 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#181820] p-8 rounded-[24px] text-center w-full max-w-[400px] shadow-2xl border border-amber-500/20"
              >
                <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Trash2 size={32} className="text-amber-400" />
                </div>
                <h2 className="text-xl font-bold mb-2 text-amber-400">Limpar Todos os Conteúdos</h2>
                <p className="text-xs text-gray-400 mb-6">
                  Tem certeza que deseja excluir <strong>TODOS</strong> os conteúdos de <strong>TODOS</strong> os cards? Esta ação é <strong>irreversível</strong>.
                </p>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={executeClearAll} 
                    className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-all flex items-center justify-center gap-2"
                  >
                    Sim, Limpar Tudo
                  </button>
                  <button 
                    onClick={() => setIsClearConfirmOpen(false)} 
                    className="text-xs text-gray-500 hover:text-white transition-colors mt-2"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* PROFILE EDIT POPUP */}
        <AnimatePresence>
          {isProfilePopupOpen && (
            <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-5 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#181820] p-8 rounded-[24px] w-full max-w-[400px] shadow-2xl border border-white/10"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold">Editar Perfil</h2>
                  <button onClick={() => {
                    setIsProfilePopupOpen(false);
                    setIsChangingPassword(false);
                    setEditPassword('');
                    setEditConfirmPassword('');
                    setEditProfileError('');
                  }} className="text-gray-500 hover:text-white">
                    <X size={24} />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col items-center mb-4">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#7C3AED] bg-[#1B1B26] flex items-center justify-center">
                        {isCompressingPhoto ? (
                          <div className="w-6 h-6 border-2 border-[#7C3AED] border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <img 
                            src={editPhotoPreview || 'https://picsum.photos/seed/user/200'} 
                            alt="Profile Preview" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full">
                        <Camera size={24} className="text-[#7C3AED]" />
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setEditPhoto(file);
                              setIsCompressingPhoto(true);
                              const reader = new FileReader();
                              reader.onloadend = async () => {
                                try {
                                  const compressed = await compressImage(reader.result as string);
                                  setEditPhotoPreview(compressed);
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.CLIENT, 'compress-photo');
                                } finally {
                                  setIsCompressingPhoto(false);
                                }
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <p className="text-sm font-medium text-[#7C3AED] mt-2">Foto de Perfil</p>
                  </div>

                  <input 
                    type="email" 
                    placeholder="E-mail"
                    className="input-field"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                  
                  <input 
                    type="text" 
                    placeholder="Nome"
                    className="input-field"
                    value={editFirstname}
                    onChange={(e) => setEditFirstname(e.target.value)}
                  />
                  
                  <input 
                    type="text" 
                    placeholder="Sobrenome"
                    className="input-field"
                    value={editLastname}
                    onChange={(e) => setEditLastname(e.target.value)}
                  />

                  <div className="mt-1 text-right text-xs text-gray-500">
                    {!isChangingPassword ? (
                      <span>
                        Esqueceu sua senha?{' '}
                        <span 
                          onClick={() => setIsChangingPassword(true)}
                          className="text-[#7C3AED] font-bold cursor-pointer hover:underline py-1"
                        >
                          Altere sua senha
                        </span>
                      </span>
                    ) : (
                      <div className="flex flex-col gap-3 pt-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold ml-1">Nova Senha</span>
                          <button 
                            type="button" 
                            onClick={() => { setIsChangingPassword(false); setEditPassword(''); setEditConfirmPassword(''); setEditProfileError(''); }} 
                            className="text-[10px] text-gray-500 hover:text-red-400 transition-colors uppercase font-bold"
                          >
                            Cancelar
                          </button>
                        </div>
                        
                        <div className="relative">
                          <input 
                            type={showEditPassword ? "text" : "password"} 
                            placeholder="Mínimo 8 caracteres" 
                            className="input-field pr-10"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                          />
                          <button 
                            type="button"
                            onClick={() => setShowEditPassword(!showEditPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                          >
                            {showEditPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        
                        <div className="relative">
                          <input 
                            type={showEditConfirmPassword ? "text" : "password"} 
                            placeholder="Confirmar nova senha" 
                            className="input-field pr-10"
                            value={editConfirmPassword}
                            onChange={(e) => setEditConfirmPassword(e.target.value)}
                          />
                          <button 
                            type="button"
                            onClick={() => setShowEditConfirmPassword(!showEditConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                          >
                            {showEditConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>

                        {editProfileError && (
                          <p className="text-[10px] text-red-500 font-bold text-center">
                            {editProfileError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={handleUpdateProfile}
                    className="primary-btn w-full mt-4"
                  >
                    Concluir
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* AUTO-SCHEDULE POPUP */}
        <AnimatePresence>
          {isAutoScheduleOpen && autoScheduleData && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-5 backdrop-blur-md">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="auth-card w-full max-w-[380px]"
              >
                <div className="logo-container">
                  <div className="w-16 h-16 bg-[#7C3AED]/20 rounded-full flex items-center justify-center mx-auto mb-6 text-[#7C3AED]">
                    <Calendar size={32} />
                  </div>
                  <h3 className="logo-text text-white mb-2">Programar Publicação</h3>
                  <p className="subtitle">Defina a data e horário para este conteúdo ser postado automaticamente no calendário.</p>
                </div>

                <div className="flex flex-col gap-5 text-left">
                  <div>
                    <label className="text-xs text-white/60 font-medium mb-2 block ml-1">Conteúdo</label>
                    <div className="input-field bg-white/[0.02] border-white/5 font-semibold truncate">
                      {autoScheduleData.content.title}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-white/60 font-medium mb-2 block ml-1">Data</label>
                      <input 
                        type="date" 
                        className="input-field"
                        value={selectedDay || ''}
                        onChange={(e) => setSelectedDay(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/60 font-medium mb-2 block ml-1">Horário</label>
                      <input 
                        type="time" 
                        className="input-field"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 mt-4">
                    <button 
                      onClick={async () => {
                        if (selectedDay && time) {
                          await sendToCalendar(autoScheduleData.stepId, {
                            ...autoScheduleData.content,
                            readyForCalendar: true
                          });
                          setIsAutoScheduleOpen(false);
                          setAutoScheduleData(null);
                        }
                      }}
                      className="primary-btn w-full"
                    >
                      Confirmar Agendamento
                    </button>
                    <button 
                      onClick={() => {
                        setIsAutoScheduleOpen(false);
                        setAutoScheduleData(null);
                      }}
                      className="text-xs text-gray-500 hover:text-white transition-colors py-2"
                    >
                      Pular por enquanto
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-center p-5 bg-[#0F0F14] relative">
      <BackgroundLights />
      <AnimatePresence mode="wait">
        {view === 'login' ? (
          <LoginView 
            loginName={loginName}
            setLoginName={setLoginName}
            loginNameError={loginNameError}
            setLoginNameError={setLoginNameError}
            loginPassword={loginPassword}
            setLoginPassword={setLoginPassword}
            loginPasswordError={loginPasswordError}
            setLoginPasswordError={setLoginPasswordError}
            showLoginPassword={showLoginPassword}
            setShowLoginPassword={setShowLoginPassword}
            loginErrorMessage={loginErrorMessage}
            handleLogin={handleLogin}
            isLoggingIn={isLoggingIn}
            setView={setView}
          />
        ) : view === 'forgot-password' ? (
          <ForgotPasswordView 
            forgotSuccess={forgotSuccess}
            forgotEmail={forgotEmail}
            setForgotEmail={setForgotEmail}
            forgotErrorMessage={forgotErrorMessage}
            handleForgotPassword={handleForgotPassword}
            isSendingReset={isSendingReset}
            setView={setView}
          />
        ) : (
          <RegisterView 
            photoError={photoError}
            isCompressingPhoto={isCompressingPhoto}
            photoPreview={photoPreview}
            fileInputRef={fileInputRef}
            setCreatePhoto={setCreatePhoto}
            setPhotoError={setPhotoError}
            setIsCompressingPhoto={setIsCompressingPhoto}
            compressImage={compressImage}
            setPhotoPreview={setPhotoPreview}
            createFirstname={createFirstname}
            setCreateFirstname={setCreateFirstname}
            firstnameError={firstnameError}
            setFirstnameError={setFirstnameError}
            createLastname={createLastname}
            setCreateLastname={setCreateLastname}
            lastnameError={lastnameError}
            setLastnameError={setLastnameError}
            createEmail={createEmail}
            setCreateEmail={setCreateEmail}
            emailError={emailError}
            setEmailError={setEmailError}
            showCreatePassword={showCreatePassword}
            setShowCreatePassword={setShowCreatePassword}
            createPassword={createPassword}
            setCreatePassword={setCreatePassword}
            passwordError={passwordError}
            setPasswordError={setPasswordError}
            showConfirmPassword={showConfirmPassword}
            setShowConfirmPassword={setShowConfirmPassword}
            createConfirm={createConfirm}
            setCreateConfirm={setCreateConfirm}
            confirmError={confirmError}
            setConfirmError={setConfirmError}
            errorMessage={errorMessage}
            handleCreateAccount={handleCreateAccount}
            isCreatingAccount={isCreatingAccount}
            setView={setView}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
