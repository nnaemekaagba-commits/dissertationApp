import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Send, Brain, User, Sparkles, Archive, X, Download, ArrowDown, FileText, LogOut, Paperclip, FileDown, Image as ImageIcon, Trash2, Eraser, Wand2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { ScrollArea } from './components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { motion } from 'motion/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { supabaseClient } from '/utils/supabase/client';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { AuthPage } from './components/AuthPage';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  aiProvider?: string;
  feedback?: string;
  attachments?: Array<{
    name: string;
    type: string;
    content?: string;
    preview?: string;
  }>;
}

interface ArchiveEntry {
  id: string;
  timestamp: Date;
  userQuery: string;
  aiProvider: string;
  aiResponse: string;
  reflection: string;
  attachments?: Message['attachments'];
}

type ChatProvider = 'openai' | 'google' | 'claude';

const CHAT_PROVIDER_OPTIONS: Array<{ id: ChatProvider; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google AI' },
  { id: 'claude', label: 'Claude' },
];

const CHAT_PROVIDER_LABELS: Record<ChatProvider, string> = {
  openai: 'OpenAI GPT-4o',
  google: 'Google Gemini',
  claude: 'Anthropic Claude',
};
const IMAGE_PROVIDER_LABEL = 'OpenAI DALL-E 3';

const formatTimestamp = (timestamp: Date) =>
  timestamp.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const getArchiveStorageKey = (currentUserId: string) => `mydis-archive:${currentUserId}`;
const getWorkspaceClearStorageKey = (currentUserId: string) => `mydis-workspace-cleared-at:${currentUserId}`;

const normalizeMessages = (rawMessages: any[] | undefined): Message[] => {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages.map((msg) => ({
    ...msg,
    timestamp: new Date(msg.timestamp),
  }));
};

const sortMessagesByTime = (items: Message[]) =>
  [...items].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

const filterMessagesForWorkspace = (messages: Message[], clearedAt: Date | null) => {
  if (!clearedAt) {
    return messages;
  }

  return messages.filter((message) => message.timestamp.getTime() > clearedAt.getTime());
};

const stripMarkdown = (content: string) =>
  content
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1: $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>-]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizePrintableText = (content: string) =>
  stripMarkdown(content)
    .replace(/\r/g, '')
    .replace(/[•◦▪]/g, '•')
    .replace(/\t/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\\\((.*?)\\\)/g, '$1')
    .replace(/\\\[(.*?)\\\]/g, '$1')
    .replace(/\\([()[\]{}])/g, '$1')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \u00A0]{2,}/g, ' ')
    .replace(/[^\S\n]+([,.;:!?])/g, '$1')
    .replace(/�/g, '')
    .trim();

const removeAttachmentMetadataFromQuery = (content: string) => {
  const marker = '\n\n**Attached Files:**';
  const markerIndex = content.indexOf(marker);
  return markerIndex >= 0 ? content.slice(0, markerIndex).trim() : content.trim();
};

const getReadableAttachmentText = (attachment: NonNullable<Message['attachments']>[number]) => {
  const header = `${attachment.name} (${attachment.type || 'Unknown file type'})`;
  const isTextLike =
    attachment.type.startsWith('text/') ||
    attachment.type === 'application/json' ||
    attachment.type === 'application/javascript' ||
    attachment.type === 'application/x-python' ||
    attachment.name.endsWith('.md') ||
    attachment.name.endsWith('.csv') ||
    attachment.name.endsWith('.py') ||
    attachment.name.endsWith('.js') ||
    attachment.name.endsWith('.java') ||
    attachment.name.endsWith('.cpp') ||
    attachment.name.endsWith('.c') ||
    attachment.name.endsWith('.html') ||
    attachment.name.endsWith('.css');

  if (attachment.type.startsWith('image/')) {
    return `${header}\nImage uploaded. Viewable in the archive interface.`;
  }

  if (attachment.type === 'application/pdf') {
    return `${header}\nPDF uploaded. Openable from the archive interface.`;
  }

  if (attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return `${header}\nWord document uploaded. Openable from the archive interface.`;
  }

  if (isTextLike) {
    return `${header}\n${normalizePrintableText(attachment.content)}`;
  }

  return `${header}\nDocument uploaded. Open from the archive interface for the original file.`;
};

const getAttachmentExportBlock = (attachments?: Message['attachments']) => {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  return attachments
    .map((attachment, index) => `${index + 1}. ${getReadableAttachmentText(attachment)}`)
    .join('\n\n');
};

const renderPrintableLines = (content: string) =>
  escapeHtml(content).replace(/\n/g, '<br />');

const getAttachmentExportMarkup = (
  attachments: Message['attachments'] | undefined,
  renderRichText: (content: string) => string
) => {
  if (!attachments || attachments.length === 0) {
    return '<div class="empty-state">No uploaded documents</div>';
  }

  return attachments.map((attachment) => {
    const typeLabel = escapeHtml(attachment.type || 'Unknown file type');
    const nameLabel = escapeHtml(attachment.name);
    const isImage = attachment.type.startsWith('image/');
    const isPdf = attachment.type === 'application/pdf';
    const isDocx = attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isTextLike =
      attachment.type.startsWith('text/') ||
      attachment.type === 'application/json' ||
      attachment.type === 'application/javascript' ||
      attachment.type === 'application/x-python' ||
      attachment.name.endsWith('.md') ||
      attachment.name.endsWith('.csv') ||
      attachment.name.endsWith('.py') ||
      attachment.name.endsWith('.js') ||
      attachment.name.endsWith('.java') ||
      attachment.name.endsWith('.cpp') ||
      attachment.name.endsWith('.c') ||
      attachment.name.endsWith('.html') ||
      attachment.name.endsWith('.css');

    let previewMarkup = '<div class="empty-state">Preview is not available for this file type in PDF export.</div>';

    if (isImage && attachment.preview) {
      previewMarkup = `<img class="attachment-image" src="${attachment.preview}" alt="${nameLabel}" />`;
    } else if (isPdf && attachment.content) {
      previewMarkup = `
        <object class="attachment-frame" data="${attachment.content}" type="application/pdf">
          <div class="empty-state">PDF preview is not available in this browser's print view.</div>
        </object>
      `;
    } else if (isTextLike) {
      previewMarkup = `<div class="attachment-richtext">${renderRichText(attachment.content)}</div>`;
    } else if (isDocx) {
      previewMarkup = '<div class="empty-state">Word documents remain available in the archive view, but this PDF export includes a document label only.</div>';
    }

    return `
      <div class="attachment-card">
        <div class="attachment-header">
          <div>
            <div class="attachment-name">${nameLabel}</div>
            <div class="attachment-type">${typeLabel}</div>
          </div>
        </div>
        ${previewMarkup}
      </div>
    `;
  }).join('');
};

const escapeHtml = (content: string) =>
  content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildArchiveEntries = (messages: Message[]): ArchiveEntry[] => {
  const entries: ArchiveEntry[] = [];
  let pendingEntry: ArchiveEntry | null = null;

  sortMessagesByTime(messages).forEach((message) => {
    if (message.role === 'user') {
      if (pendingEntry) {
        entries.push(pendingEntry);
      }

      pendingEntry = {
        id: message.id,
        timestamp: message.timestamp,
        userQuery: message.content,
        aiProvider: message.aiProvider || 'Provider not recorded',
        aiResponse: '',
        reflection: '',
        attachments: message.attachments,
      };
      return;
    }

    if (!pendingEntry) {
      pendingEntry = {
        id: message.id,
        timestamp: message.timestamp,
        userQuery: '',
        aiProvider: message.aiProvider || 'Provider not recorded',
        aiResponse: message.content,
        reflection: message.feedback || '',
        attachments: message.attachments,
      };
      entries.push(pendingEntry);
      pendingEntry = null;
      return;
    }

    pendingEntry = {
      ...pendingEntry,
      aiProvider: message.aiProvider || pendingEntry.aiProvider,
      attachments: pendingEntry.attachments || message.attachments,
      aiResponse: pendingEntry.aiResponse
        ? `${pendingEntry.aiResponse}\n\n${message.content}`
        : message.content,
      reflection: message.feedback || pendingEntry.reflection,
    };
    entries.push(pendingEntry);
    pendingEntry = null;
  });

  if (pendingEntry) {
    entries.push(pendingEntry);
  }

  return entries;
};

const applyFeedbackToMessages = (messages: Message[], messageId: string, feedback: string) =>
  messages.map((message) =>
    message.id === messageId ? { ...message, feedback } : message
  );

const mergeArchiveMessages = (primaryMessages: Message[], fallbackMessages: Message[]) => {
  const mergedMessages = new Map<string, Message>();

  [...fallbackMessages, ...primaryMessages].forEach((message) => {
    const existing = mergedMessages.get(message.id);
    if (!existing) {
      mergedMessages.set(message.id, message);
      return;
    }

    mergedMessages.set(message.id, {
      ...existing,
      ...message,
      aiProvider: message.aiProvider || existing.aiProvider,
      feedback: message.feedback ?? existing.feedback,
      attachments: message.attachments || existing.attachments,
      timestamp: message.timestamp || existing.timestamp,
    });
  });

  return sortMessagesByTime(Array.from(mergedMessages.values()));
};

// Memoized message component to prevent re-renders when input changes
const MessageItem = memo(({ 
  message, 
  onFeedbackChange,
  normalizeContent
}: { 
  message: Message;
  onFeedbackChange: (id: string, feedback: string) => void;
  normalizeContent: boolean;
}) => {
  return (
    <div
      key={message.id}
      className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
    >
      <div className={`size-8 rounded-full flex items-center justify-center ${message.role === 'user' ? 'bg-blue-600' : 'bg-purple-600'}`}>
        {message.role === 'user' ? <User className="size-4 text-white" /> : <Sparkles className="size-4 text-white" />}
      </div>
      <div className="flex-1">
        <div className={`p-3 rounded-lg ${message.role === 'user' ? 'bg-blue-100 font-bold' : 'bg-gray-100'}`}>
          <MarkdownRenderer content={message.content} normalizeContent={normalizeContent} />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {message.aiProvider ? `${message.aiProvider} · ` : ''}
          {formatTimestamp(message.timestamp)}
        </div>
        
        {message.role === 'assistant' && (
          <div className="mt-2">
            <div className="bg-gradient-to-r from-purple-100 to-pink-100 border border-purple-300 rounded-lg p-3">
              <label className="block text-xs font-semibold text-purple-900 mb-1">
                💭 Reflection
              </label>
              <p className="text-xs text-purple-700 mb-2">
                What did you do with this response? How did you use it in your solution?
              </p>
              <Textarea
                value={message.feedback || ''}
                onChange={(e) => onFeedbackChange(message.id, e.target.value)}
                placeholder="Describe how you used this response..."
                className="min-h-[60px] text-sm bg-white border-purple-300 focus:border-purple-500 focus:ring-purple-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

const AttachmentPreview = ({ attachment }: { attachment: NonNullable<Message['attachments']>[number] }) => {
  const isImage = attachment.type.startsWith('image/');
  const isPdf = attachment.type === 'application/pdf';
  const isDocx = attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isTextLike =
    attachment.type.startsWith('text/') ||
    attachment.type === 'application/json' ||
    attachment.type === 'application/javascript' ||
    attachment.type === 'application/x-python' ||
    attachment.name.endsWith('.md') ||
    attachment.name.endsWith('.csv') ||
    attachment.name.endsWith('.py') ||
    attachment.name.endsWith('.js') ||
    attachment.name.endsWith('.java') ||
    attachment.name.endsWith('.cpp') ||
    attachment.name.endsWith('.c') ||
    attachment.name.endsWith('.html') ||
    attachment.name.endsWith('.css');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{attachment.name}</div>
          <div className="text-[11px] text-gray-500">{attachment.type || 'Unknown file type'}</div>
        </div>
        {attachment.content && (
          <a
            href={attachment.content}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Open
          </a>
        )}
      </div>

      {isImage && attachment.preview && (
        <img
          src={attachment.preview}
          alt={attachment.name}
          className="max-h-72 w-full rounded-md border border-gray-200 object-contain"
        />
      )}

      {isPdf && attachment.content && (
        <iframe
          src={attachment.content}
          title={attachment.name}
          className="h-80 w-full rounded-md border border-gray-200 bg-white"
        />
      )}

      {isTextLike && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
          {attachment.content}
        </pre>
      )}

      {isDocx && attachment.content && (
        <div className="space-y-2">
          <iframe
            src={attachment.content}
            title={attachment.name}
            className="h-80 w-full rounded-md border border-gray-200 bg-white"
          />
          <p className="text-xs text-gray-500">
            If your browser cannot render this Word document inline, use the Open link above.
          </p>
        </div>
      )}

      {!isImage && !isPdf && !isTextLike && !isDocx && (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
          Preview is not available for this file type in the archive. Use the Open link to view it.
        </div>
      )}
    </div>
  );
};

const API_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-09672449`;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [archiveMessages, setArchiveMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; type: string; content: string; preview?: string }>>([]);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>('openai');
  const [normalizeRenderedContent, setNormalizeRenderedContent] = useState(false);
  const [showClearLogDialog, setShowClearLogDialog] = useState(false);
  const [showClearWorkspaceDialog, setShowClearWorkspaceDialog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildApiHeaders = useCallback(
    (includeJsonContentType = false) => {
      const headers: Record<string, string> = {
        apikey: publicAnonKey,
      };

      if (includeJsonContentType) {
        headers['Content-Type'] = 'application/json';
      }

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      return headers;
    },
    [accessToken]
  );

  const loadLocalArchive = useCallback((currentUserId: string) => {
    try {
      const stored = localStorage.getItem(getArchiveStorageKey(currentUserId));
      if (!stored) {
        return [];
      }

      return normalizeMessages(JSON.parse(stored));
    } catch (error) {
      console.error('Failed to load local archive:', error);
      return [];
    }
  }, []);

  const loadWorkspaceClearedAt = useCallback((currentUserId: string) => {
    try {
      const stored = localStorage.getItem(getWorkspaceClearStorageKey(currentUserId));
      if (!stored) {
        return null;
      }

      const clearedAt = new Date(stored);
      return Number.isNaN(clearedAt.getTime()) ? null : clearedAt;
    } catch (error) {
      console.error('Failed to load workspace clear timestamp:', error);
      return null;
    }
  }, []);

  const persistWorkspaceClearedAt = useCallback((currentUserId: string, clearedAt: Date) => {
    try {
      localStorage.setItem(getWorkspaceClearStorageKey(currentUserId), clearedAt.toISOString());
    } catch (error) {
      console.error('Failed to persist workspace clear timestamp:', error);
    }
  }, []);

  const resetWorkspaceClearedAt = useCallback((currentUserId: string) => {
    try {
      localStorage.removeItem(getWorkspaceClearStorageKey(currentUserId));
    } catch (error) {
      console.error('Failed to reset workspace clear timestamp:', error);
    }
  }, []);

  const persistArchive = useCallback((currentUserId: string, nextMessages: Message[]) => {
    try {
      localStorage.setItem(getArchiveStorageKey(currentUserId), JSON.stringify(nextMessages));
    } catch (error) {
      console.error('Failed to persist archive locally:', error);
    }
  }, []);

  const upsertArchiveMessage = useCallback((currentUserId: string, message: Message) => {
    setArchiveMessages((prev) => {
      const existing = prev.filter((item) => item.id !== message.id);
      const nextMessages = sortMessagesByTime([...existing, message]);
      persistArchive(currentUserId, nextMessages);
      return nextMessages;
    });
  }, [persistArchive]);

  const replaceArchiveMessages = useCallback((currentUserId: string, nextMessages: Message[]) => {
    const sortedMessages = sortMessagesByTime(nextMessages);
    setArchiveMessages(sortedMessages);
    persistArchive(currentUserId, sortedMessages);
  }, [persistArchive]);

  // Check for existing session on load
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      
      if (session?.access_token) {
        const currentUserId = session.user?.id || 'guest';
        const localArchive = loadLocalArchive(currentUserId);
        const workspaceClearedAt = loadWorkspaceClearedAt(currentUserId);
        setAccessToken(session.access_token);
        setUserName(session.user?.user_metadata?.name || session.user?.email?.split('@')[0] || 'User');
        setUserEmail(session.user?.email || '');
        setUserId(currentUserId);
        setArchiveMessages(localArchive);
        
        // Load messages for this user
        try {
          const response = await fetch(`${API_BASE_URL}/messages/${currentUserId}`, {
            headers: buildApiHeaders()
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.messages && Array.isArray(data.messages)) {
              const loadedMessages = normalizeMessages(data.messages);
              const nextMessages = mergeArchiveMessages(loadedMessages, localArchive);
              setMessages(filterMessagesForWorkspace(nextMessages, workspaceClearedAt));
              replaceArchiveMessages(currentUserId, nextMessages);
              console.log(`✅ Loaded ${loadedMessages.length} messages on session restore`);
            }
          }
        } catch (error) {
          console.log('Failed to load messages:', error);
          setMessages(filterMessagesForWorkspace(localArchive, workspaceClearedAt));
        }
        
        setIsAuthenticated(true);
      }
    };
    
    checkSession();
  }, [buildApiHeaders, loadLocalArchive, loadWorkspaceClearedAt, replaceArchiveMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Load archive messages when archive panel is opened
  useEffect(() => {
    const loadArchiveMessages = async () => {
      if (showArchive && userId) {
        const localArchive = loadLocalArchive(userId);
        if (localArchive.length > 0) {
          setArchiveMessages(localArchive);
        }

        try {
          const response = await fetch(`${API_BASE_URL}/messages/${userId}`, {
            headers: buildApiHeaders()
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.messages && Array.isArray(data.messages)) {
              const loadedMessages = normalizeMessages(data.messages);
              replaceArchiveMessages(userId, mergeArchiveMessages(loadedMessages, localArchive));
              console.log(`✅ Loaded ${loadedMessages.length} archive messages`);
            }
          }
        } catch (error) {
          console.log('Failed to load archive messages:', error);
        }
      }
    };
    
    loadArchiveMessages();
  }, [buildApiHeaders, showArchive, userId, loadLocalArchive, replaceArchiveMessages]);

  // Callback for updating feedback
  const updateFeedback = useCallback(async (messageId: string, feedback: string) => {
    setMessages((prev) => applyFeedbackToMessages(prev, messageId, feedback));

    if (userId) {
      setArchiveMessages((prev) => {
        const nextMessages = applyFeedbackToMessages(prev, messageId, feedback);
        persistArchive(userId, nextMessages);
        return nextMessages;
      });
    }
    
    // Save feedback to database
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${userId}/${messageId}/feedback`, {
        method: 'PUT',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ feedback })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Failed to save feedback remotely:', errorData?.error || response.statusText);
      }
    } catch (error) {
      console.error('Failed to save feedback:', error);
    }
  }, [buildApiHeaders, userId, persistArchive]);

  // Save a message to the database
  const saveMessage = useCallback(async (message: Message) => {
    if (userId) {
      upsertArchiveMessage(userId, message);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/messages/${userId}`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Failed to save message remotely:', errorData?.error || response.statusText);
      }
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  }, [buildApiHeaders, userId, upsertArchiveMessage]);

  const handleAuthSuccess = async (token: string, name: string) => {
    setAccessToken(token);
    setUserName(name);
    setUserEmail('');
    
    // Get userId FIRST before setting isAuthenticated
    let newUserId = '';
    if (token) {
      // Authenticated user - get user ID from session
      const { data: { session } } = await supabaseClient.auth.getSession();
      newUserId = session?.user?.id || 'guest';
      setUserEmail(session?.user?.email || '');
    } else {
      // Guest mode
      newUserId = 'guest';
    }
    
    setUserId(newUserId);
    const localArchive = loadLocalArchive(newUserId);
    const workspaceClearedAt = loadWorkspaceClearedAt(newUserId);
    setArchiveMessages(localArchive);
    
    // Load messages for this user
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${newUserId}`, {
        headers: {
          apikey: publicAnonKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.messages && Array.isArray(data.messages)) {
          const loadedMessages = normalizeMessages(data.messages);
          const nextMessages = mergeArchiveMessages(loadedMessages, localArchive);
          setMessages(filterMessagesForWorkspace(nextMessages, workspaceClearedAt));
          replaceArchiveMessages(newUserId, nextMessages);
          console.log(`✅ Loaded ${loadedMessages.length} messages for user ${newUserId}`);
        }
      }
    } catch (error) {
      console.log('Failed to load messages:', error);
      setMessages(filterMessagesForWorkspace(localArchive, workspaceClearedAt));
    }
    
    // Set authenticated AFTER everything is loaded
    setIsAuthenticated(true);
  };

  const handleSignOut = async () => {
    // Only sign out from Supabase if not in guest mode
    if (accessToken) {
      await supabaseClient.auth.signOut();
    }
    
    setIsAuthenticated(false);
    setAccessToken(null);
    setUserName('');
    setUserEmail('');
    setUserId('');
    setMessages([]);
    setArchiveMessages([]);
  };

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: Array<{ name: string; type: string; content: string; preview?: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileType = file.type;
      
      try {
        if (fileType.startsWith('image/')) {
          // Handle images - convert to base64
          const reader = new FileReader();
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          newFiles.push({ name: file.name, type: fileType, content, preview: content });
        } else if (fileType === 'application/pdf' || fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          // Handle PDF and Word documents - convert to base64
          const reader = new FileReader();
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          newFiles.push({ name: file.name, type: fileType, content });
        } else if (
          fileType.startsWith('text/') ||
          fileType === 'application/json' ||
          fileType === 'application/javascript' ||
          fileType === 'application/x-python' ||
          file.name.endsWith('.txt') ||
          file.name.endsWith('.md') ||
          file.name.endsWith('.csv') ||
          file.name.endsWith('.py') ||
          file.name.endsWith('.js') ||
          file.name.endsWith('.java') ||
          file.name.endsWith('.cpp') ||
          file.name.endsWith('.c') ||
          file.name.endsWith('.html') ||
          file.name.endsWith('.css')
        ) {
          // Handle text files - read as text
          const reader = new FileReader();
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
          });
          newFiles.push({ name: file.name, type: fileType || 'text/plain', content });
        } else {
          alert(`File type "${fileType || 'unknown'}" for "${file.name}" is not supported. Please upload images, PDFs, Word documents, or text files.`);
        }
      } catch (error) {
        console.error(`Error reading file ${file.name}:`, error);
        alert(`Failed to read file: ${file.name}`);
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!input.trim() && uploadedFiles.length === 0) return;

    // Build message content with files
    let messageContent = input;
    const fileContents: Array<{ name: string; type: string; content: string }> = [];
    
    if (uploadedFiles.length > 0) {
      messageContent += '\n\n**Attached Files:**\n';
      uploadedFiles.forEach((file, index) => {
        if (file.type.startsWith('image/')) {
          messageContent += `\n${index + 1}. Image: ${file.name}`;
          fileContents.push({ name: file.name, type: file.type, content: file.content });
        } else if (file.type.startsWith('text/') || file.type === 'application/json') {
          messageContent += `\n${index + 1}. ${file.name}:\n\`\`\`\n${file.content}\n\`\`\``;
        } else if (file.type === 'application/pdf') {
          messageContent += `\n${index + 1}. PDF Document: ${file.name}`;
          fileContents.push({ name: file.name, type: file.type, content: file.content });
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          messageContent += `\n${index + 1}. Word Document: ${file.name}`;
          fileContents.push({ name: file.name, type: file.type, content: file.content });
        } else {
          messageContent += `\n${index + 1}. File: ${file.name}`;
        }
      });
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      aiProvider: CHAT_PROVIDER_LABELS[selectedProvider],
      attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined
    };

    setMessages(prev => [...prev, userMessage]);
    saveMessage(userMessage);
    const currentInput = messageContent;
    const currentFiles = fileContents;
    setInput('');
    setUploadedFiles([]);
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ 
          message: currentInput, 
          conversationHistory: messages,
          files: currentFiles,
          provider: selectedProvider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to get response`);
      }

      const data = await response.json();
      console.log('🔍 Received from API:', { hasIsIncorrect: 'isIncorrect' in data, isIncorrect: data.isIncorrect });
      console.log('📊 SERVER RESPONSE - isIncorrect flag:', data.isIncorrect);
      const providerUsed = data.providerUsed && data.providerUsed in CHAT_PROVIDER_LABELS
        ? CHAT_PROVIDER_LABELS[data.providerUsed as ChatProvider]
        : CHAT_PROVIDER_LABELS[selectedProvider];
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        aiProvider: providerUsed
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      saveMessage(assistantMessage);
    } catch (error) {
      console.error('Error during AI request:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ **Error**: Sorry, there was an error processing your request.\n\n**Details**: ${errorMessage}`,
        timestamp: new Date(),
        aiProvider: CHAT_PROVIDER_LABELS[selectedProvider]
      };
      setMessages(prev => [...prev, assistantMessage]);
      saveMessage(assistantMessage);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Date', 'Time', 'AI Provider', 'User Query', 'Uploaded Documents', 'AI Response', 'Reflection'];
    const rows = archiveEntries.map((entry) => {
      const date = entry.timestamp.toLocaleDateString();
      const time = entry.timestamp.toLocaleTimeString();
      const aiProvider = `"${entry.aiProvider.replace(/"/g, '""')}"`;
      const userQuery = `"${normalizePrintableText(removeAttachmentMetadataFromQuery(entry.userQuery)).replace(/"/g, '""')}"`;
      const attachments = `"${getAttachmentExportBlock(entry.attachments).replace(/"/g, '""')}"`;
      const aiResponse = `"${normalizePrintableText(entry.aiResponse).replace(/"/g, '""')}"`;
      const reflection = `"${normalizePrintableText(entry.reflection).replace(/"/g, '""')}"`;
      return [entry.timestamp.toISOString(), date, time, aiProvider, userQuery, attachments, aiResponse, reflection].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `activity-log-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToDocx = () => {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "Activity Log",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            ...archiveEntries.flatMap((entry, index) => {
              const timestamp = formatTimestamp(entry.timestamp);
              const queryText = normalizePrintableText(removeAttachmentMetadataFromQuery(entry.userQuery)) || 'No user query recorded';
              const attachmentText = getAttachmentExportBlock(entry.attachments);
              const responseText = normalizePrintableText(entry.aiResponse) || 'No AI response recorded';
              const reflectionText = normalizePrintableText(entry.reflection) || 'No reflection provided';

              return [
                new Paragraph({
                  text: `Activity ${index + 1}`,
                  heading: HeadingLevel.HEADING_2,
                  spacing: { before: 240, after: 120 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Timestamp: ', bold: true }),
                    new TextRun(timestamp),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'AI Provider: ', bold: true }),
                    new TextRun(entry.aiProvider),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'User Query', bold: true }),
                  ],
                  spacing: { before: 160, after: 80 },
                }),
                new Paragraph({
                  text: queryText,
                }),
                ...(attachmentText
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({ text: 'Uploaded Documents', bold: true }),
                        ],
                        spacing: { before: 160, after: 80 },
                      }),
                      new Paragraph({
                        text: attachmentText,
                      }),
                    ]
                  : []),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'AI Response', bold: true }),
                  ],
                  spacing: { before: 160, after: 80 },
                }),
                new Paragraph({
                  text: responseText,
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Reflection', bold: true, color: '7C3AED' }),
                  ],
                  spacing: { before: 160, after: 80 },
                }),
                new Paragraph({
                  text: reflectionText,
                }),
              ];
            }),
          ],
        },
      ],
    });

    Packer.toBlob(doc).then(blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `activity-log-${new Date().toISOString().split('T')[0]}.docx`;
      link.click();
    });
  };

  const exportToPDF = () => {
    const printableUserName = userName || 'Guest User';
    const printableUserEmail = userEmail || 'Guest session';
    const sharedStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('\n');
    const renderRichText = (content: string) =>
      renderToStaticMarkup(
        <MarkdownRenderer
          content={content}
          normalizeContent={normalizeRenderedContent}
          className="export-markdown"
        />
      );
    const archiveMarkup = archiveEntries.map((entry, index) => {
      const timestamp = escapeHtml(formatTimestamp(entry.timestamp));
      const querySource = removeAttachmentMetadataFromQuery(entry.userQuery) || 'No user query recorded';
      const queryText = renderRichText(querySource);
      const attachmentMarkup = getAttachmentExportMarkup(entry.attachments, renderRichText);
      const responseText = renderRichText(entry.aiResponse || 'No AI response recorded');
      const reflectionText = renderPrintableLines(normalizePrintableText(entry.reflection) || 'No reflection provided');
      const provider = escapeHtml(entry.aiProvider || 'Provider not recorded');

      return `
        <section class="entry">
          <div class="entry-header">
            <h2>Activity ${index + 1}</h2>
            <div class="timestamp">${timestamp}</div>
          </div>
          <div class="provider">${provider}</div>
          <div class="field">
            <div class="label">User Query</div>
            <div class="value query">${queryText}</div>
          </div>
          <div class="field">
            <div class="label">Uploaded Documents</div>
            <div class="attachments-list">${attachmentMarkup}</div>
          </div>
          <div class="field">
            <div class="label">AI Response</div>
            <div class="value response">${responseText}</div>
          </div>
          <div class="field">
            <div class="label reflection-label">Reflection</div>
            <div class="value reflection">${reflectionText}</div>
          </div>
        </section>
      `;
    }).join('');

    const printDocumentHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Activity Log PDF Export</title>
          ${sharedStyles}
          <style>
            body {
              font-family: Georgia, "Times New Roman", serif;
              color: #1f2937;
              margin: 0;
              padding: 36px;
              background: #f4f7fb;
            }
            .page-title {
              text-align: center;
              margin-bottom: 6px;
              font-size: 30px;
              letter-spacing: 0.02em;
            }
            .page-subtitle {
              text-align: center;
              color: #6b7280;
              margin-bottom: 10px;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .page-user {
              text-align: center;
              margin-bottom: 28px;
              color: #1f2937;
              font-family: Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
            }
            .page-user strong {
              color: #111827;
            }
            .entry {
              background: #ffffff;
              border: 1px solid #dbe4f0;
              border-radius: 16px;
              padding: 22px;
              margin-bottom: 20px;
              box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
              page-break-inside: avoid;
            }
            .entry-header {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              align-items: baseline;
              margin-bottom: 12px;
            }
            .entry-header h2 {
              font-size: 21px;
              margin: 0;
            }
            .timestamp {
              color: #6b7280;
              font-size: 12px;
              white-space: nowrap;
            }
            .provider {
              color: #4f46e5;
              font-family: Arial, sans-serif;
              font-weight: 700;
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin-bottom: 18px;
            }
            .field {
              margin-top: 16px;
            }
            .label {
              font-size: 12px;
              font-weight: 700;
              margin-bottom: 7px;
              font-family: Arial, sans-serif;
              color: #374151;
            }
            .reflection-label {
              color: #581c87;
            }
            .value {
              border-radius: 12px;
              border: 1px solid #dbe4f0;
              padding: 14px 15px;
              line-height: 1.7;
              font-size: 14px;
              word-break: break-word;
              white-space: pre-wrap;
            }
            .value :first-child,
            .attachment-richtext :first-child {
              margin-top: 0;
            }
            .value :last-child,
            .attachment-richtext :last-child {
              margin-bottom: 0;
            }
            .query {
              background: #f5f9ff;
              border-color: #cfe0ff;
            }
            .response {
              background: #ffffff;
            }
            .attachments {
              background: #f8fafc;
              border-color: #d7e1ee;
            }
            .reflection {
              background: #faf5ff;
              border-color: #eadcff;
              color: #6b21a8;
            }
            .attachments-list {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .attachment-card {
              border-radius: 12px;
              border: 1px solid #d7e1ee;
              background: #ffffff;
              padding: 14px;
            }
            .attachment-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 10px;
            }
            .attachment-name {
              font-family: Arial, sans-serif;
              font-size: 14px;
              font-weight: 700;
              color: #111827;
              word-break: break-word;
            }
            .attachment-type {
              font-family: Arial, sans-serif;
              font-size: 11px;
              color: #6b7280;
              margin-top: 2px;
            }
            .attachment-image {
              display: block;
              max-width: 100%;
              max-height: 420px;
              margin: 0 auto;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              object-fit: contain;
            }
            .attachment-frame {
              width: 100%;
              height: 480px;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              background: #ffffff;
            }
            .attachment-text {
              margin: 0;
              white-space: pre-wrap;
              word-break: break-word;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              background: #f8fafc;
              padding: 12px;
              font-family: "Courier New", monospace;
              font-size: 12px;
              line-height: 1.6;
              color: #1f2937;
            }
            .attachment-richtext {
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              background: #f8fafc;
              padding: 12px;
            }
            .export-markdown {
              font-size: 14px;
              line-height: 1.7;
              color: #1f2937;
            }
            .export-markdown pre {
              white-space: pre-wrap;
              word-break: break-word;
            }
            .export-markdown .katex-display {
              overflow-x: auto;
              overflow-y: hidden;
              padding: 6px 0;
            }
            .empty-state {
              border-radius: 8px;
              border: 1px dashed #cbd5e1;
              background: #f8fafc;
              padding: 12px;
              font-family: Arial, sans-serif;
              font-size: 12px;
              color: #64748b;
            }
            @media print {
              body {
                background: #ffffff;
                padding: 20px;
              }
              .entry {
                box-shadow: none;
              }
              .attachment-card {
                break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <h1 class="page-title">Activity Log</h1>
          <div class="page-subtitle">Exported ${escapeHtml(new Date().toLocaleString())}</div>
          <div class="page-user">
            <div><strong>User:</strong> ${escapeHtml(printableUserName)}</div>
            <div><strong>Email:</strong> ${escapeHtml(printableUserEmail)}</div>
          </div>
          ${archiveMarkup || '<p>No archive entries available.</p>'}
        </body>
      </html>
    `;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.setAttribute('aria-hidden', 'true');

    const cleanup = () => {
      window.setTimeout(() => {
        if (printFrame.parentNode) {
          printFrame.parentNode.removeChild(printFrame);
        }
      }, 300);
    };

    printFrame.onload = () => {
      const frameWindow = printFrame.contentWindow;

      if (!frameWindow) {
        cleanup();
        window.alert('Unable to prepare the PDF export. Please try again.');
        return;
      }

      frameWindow.focus();
      frameWindow.onafterprint = cleanup;
      window.setTimeout(() => {
        frameWindow.print();
      }, 250);
    };

    document.body.appendChild(printFrame);
    const frameDocument = printFrame.contentDocument;

    if (!frameDocument) {
      cleanup();
      window.alert('Unable to prepare the PDF export. Please try again.');
      return;
    }

    frameDocument.open();
    frameDocument.write(printDocumentHtml);
    frameDocument.close();
  };

  const clearLog = async () => {
    setShowClearLogDialog(false);

    try {
      // Delete all messages from the database for this user
      const response = await fetch(`${API_BASE_URL}/messages/${userId}`, {
        method: 'DELETE',
        headers: buildApiHeaders()
      });

      if (response.ok) {
        setMessages([]);
        setArchiveMessages([]);
        localStorage.removeItem(getArchiveStorageKey(userId));
        resetWorkspaceClearedAt(userId);
        console.log('✅ All messages cleared successfully');
      } else {
        const errorData = await response.json();
        console.error('Failed to clear messages:', errorData.error);
        alert('Failed to clear messages. Please try again.');
      }
    } catch (error) {
      console.error('Error clearing messages:', error);
      alert('Failed to clear messages. Please try again.');
    }
  };

  const clearWorkspace = () => {
    setShowClearWorkspaceDialog(false);
    
    if (userId) {
      persistWorkspaceClearedAt(userId, new Date());
    }

    // Clear only the current workspace view while preserving archive history.
    setMessages([]);
    console.log('✅ Workspace cleared (archive preserved)');
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      alert('Please enter a description for the image you want to generate.');
      return;
    }

    setIsGeneratingImage(true);
    
    // Add user's image generation request to chat
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `**Generate Image**: ${imagePrompt}`,
      timestamp: new Date(),
      aiProvider: IMAGE_PROVIDER_LABEL
    };
    
    setMessages(prev => [...prev, userMessage]);
    saveMessage(userMessage);
    const prompt = imagePrompt;
    setImagePrompt('');
    setShowImageDialog(false);

    try {
      console.log('🎨 Sending image generation request:', { prompt });
      const response = await fetch(`${API_BASE_URL}/generate-image`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ prompt }),
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Error from server:', errorData);
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const data = await response.json();
      console.log('✅ Image generated successfully:', data);
      
      // Add generated image as assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `🎨 **Generated Image**\n\n![Generated Image](${data.imageUrl})\n\n**Prompt**: ${data.revisedPrompt}`,
        timestamp: new Date(),
        aiProvider: IMAGE_PROVIDER_LABEL
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      saveMessage(assistantMessage);
    } catch (error) {
      console.error('❌ Error generating image:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ **Image Generation Error**: Sorry, there was an error generating the image.\n\n**Details**: ${errorMessage}`,
        timestamp: new Date(),
        aiProvider: IMAGE_PROVIDER_LABEL
      };
      setMessages(prev => [...prev, assistantMessage]);
      saveMessage(assistantMessage);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Check if the last assistant message has a reflection
  const lastAssistantMessage = [...messages].reverse().find(msg => msg.role === 'assistant');
  const needsReflection = lastAssistantMessage && !lastAssistantMessage.feedback?.trim();
  const canSendMessage = !needsReflection && (input.trim() || uploadedFiles.length > 0);
  const archiveEntries = buildArchiveEntries(archiveMessages);
  const archiveQueryCount = archiveEntries.length;

  return (
    <div className="h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
      <div className="w-full h-full bg-white flex flex-col">{/* Header */}
        <div className="p-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white flex-shrink-0">
          <div className="flex items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <Brain className="size-6" />
              <div>
                <h1 className="text-lg font-semibold">Open-Ended Problem Solving Support</h1>
                <p className="text-xs text-white/80">Welcome, {userName}!</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowClearWorkspaceDialog(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"
                title="Clear Workspace (preserves archive)"
              >
                <Eraser className="size-4" />
                <span className="text-sm">Clear Workspace</span>
              </button>
              <button
                onClick={() => setShowArchive(!showArchive)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"
              >
                <Archive className="size-4" />
                <span className="text-sm">Archive</span>
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"
                title="Sign Out"
              >
                <LogOut className="size-4" />
                <span className="text-sm">Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Chat */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              <div ref={scrollRef} className="space-y-4">
                {messages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    onFeedbackChange={updateFeedback}
                    normalizeContent={normalizeRenderedContent}
                  />
                ))}
                
                {isTyping && (
                  <div className="flex gap-3">
                    <div className="size-8 rounded-full bg-purple-600 flex items-center justify-center">
                      <Sparkles className="size-4 text-white" />
                    </div>
                    <div className="p-3 rounded-lg bg-gray-100">
                      <div className="flex gap-1">
                        <span className="size-2 bg-gray-400 rounded-full animate-bounce"></span>
                        <span className="size-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="size-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input */}
            <div className="p-4 border-t bg-white">
              {/* Reflection Reminder */}
              {needsReflection && (
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-300 rounded-lg flex items-start gap-2">
                  <div className="size-5 rounded-full bg-yellow-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-yellow-900 mb-1">Reflection Required</p>
                    <p className="text-xs text-yellow-800">
                      Please complete the reflection for the AI's last response before continuing.
                    </p>
                  </div>
                </div>
              )}
              
              {/* File Previews */}
              {uploadedFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      {file.type.startsWith('image/') ? (
                        <ImageIcon className="size-4 text-blue-600" />
                      ) : (
                        <File className="size-4 text-blue-600" />
                      )}
                      <span className="text-sm text-blue-900 max-w-[200px] truncate">{file.name}</span>
                      <button
                        onClick={() => removeFile(index)}
                        className="size-5 rounded-full bg-blue-200 hover:bg-blue-300 flex items-center justify-center"
                      >
                        <X className="size-3 text-blue-900" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  AI Provider
                </span>
                <button
                  type="button"
                  onClick={() => setNormalizeRenderedContent(prev => !prev)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition flex items-center gap-2 ${
                    normalizeRenderedContent
                      ? 'border-purple-600 bg-purple-600 text-white shadow-sm'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700'
                  }`}
                  title="Render text and formulas more cleanly"
                >
                  <Wand2 className="size-4" />
                  <span>{normalizeRenderedContent ? 'Rendered' : 'Render Text + Formula'}</span>
                </button>
                {CHAT_PROVIDER_OPTIONS.map((providerOption) => (
                  <button
                    key={providerOption.id}
                    type="button"
                    onClick={() => setSelectedProvider(providerOption.id)}
                    disabled={isTyping}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      selectedProvider === providerOption.id
                        ? 'border-purple-600 bg-purple-600 text-white shadow-sm'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700'
                    } ${isTyping ? 'cursor-not-allowed opacity-70' : ''}`}
                  >
                    {providerOption.label}
                  </button>
                ))}
              </div>
              
              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-2">
                  <div className="relative">
                    <Button
                      onClick={handleSend}
                      size="icon"
                      className="absolute right-2 top-1/2 z-10 size-10 -translate-y-1/2 rounded-xl"
                      disabled={!canSendMessage}
                    >
                      <Send className="size-5" />
                    </Button>
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder={needsReflection ? "Please complete the reflection above to continue..." : "Describe your problem or ask a question..."}
                      className="flex-1 min-h-[60px] pr-14"
                      disabled={needsReflection}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      accept="image/*,.pdf,.docx,.txt,.md,.csv,.py,.js,.java,.cpp,.c,.html,.css,.json"
                      className="hidden"
                      disabled={needsReflection}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2"
                      disabled={needsReflection}
                    >
                      <Paperclip className="size-4" />
                      <span>Attach Files</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowImageDialog(true)}
                      className="flex items-center gap-2 bg-gradient-to-r from-pink-50 to-purple-50 hover:from-pink-100 hover:to-purple-100 border-purple-300"
                      disabled={needsReflection}
                      title="Generate images with DALL-E 3"
                    >
                      <Wand2 className="size-4 text-purple-600" />
                      <span className="text-purple-600 font-semibold">Generate Image (DALL-E)</span>
                    </Button>
                    <span className="text-xs text-gray-500">
                      Supports images, PDFs, Word documents, and text files
                    </span>
                  </div>
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Button
                    onClick={scrollToBottom}
                    size="icon"
                    className="size-[60px] bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"
                    title="Jump to Latest Message"
                    disabled={messages.length === 0}
                  >
                    <ArrowDown className="size-5" />
                  </Button>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Archive Panel */}
          {showArchive && (
            <div className="w-80 bg-white border-l flex flex-col flex-shrink-0">
              <div className="p-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Archive</h2>
                  <p className="text-xs">Total: {archiveQueryCount}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setShowClearLogDialog(true)} className="size-8 rounded hover:bg-white/20 flex items-center justify-center" title="Clear All Messages">
                    <Trash2 className="size-4" />
                  </button>
                  <button onClick={exportToCSV} className="size-8 rounded hover:bg-white/20 flex items-center justify-center" title="Export to CSV">
                    <Download className="size-4" />
                  </button>
                  <button onClick={exportToDocx} className="size-8 rounded hover:bg-white/20 flex items-center justify-center" title="Export to DOCX">
                    <FileText className="size-4" />
                  </button>
                  <button onClick={exportToPDF} className="h-8 px-2 rounded hover:bg-white/20 flex items-center justify-center gap-1 text-[11px] font-semibold" title="Export to PDF">
                    <FileDown className="size-4" />
                    <span>PDF</span>
                  </button>
                  <button onClick={() => setShowArchive(false)} className="size-8 rounded hover:bg-white/20 flex items-center justify-center" title="Close Archive">
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3">
                {archiveEntries.map((entry, index) => (
                  <div key={entry.id} className="p-3 mb-3 rounded-lg border bg-gray-50 border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-sm">
                        Activity {index + 1}
                      </div>
                      <div className="text-xs text-gray-500">{formatTimestamp(entry.timestamp)}</div>
                    </div>
                    <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-purple-700">
                      {entry.aiProvider || 'Provider not recorded'}
                    </div>
                    <div className="mb-3">
                      <div className="mb-1 text-xs font-semibold text-gray-700">User Query</div>
                      <div className="text-sm rounded-md bg-blue-50 border border-blue-100 p-2">
                        {entry.userQuery ? <MarkdownRenderer content={entry.userQuery} normalizeContent={normalizeRenderedContent} /> : <span className="text-gray-500">No user query recorded</span>}
                      </div>
                    </div>
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="mb-3">
                        <div className="mb-2 text-xs font-semibold text-gray-700">Uploaded Documents</div>
                        <div className="space-y-3">
                          {entry.attachments.map((attachment, attachmentIndex) => (
                            <AttachmentPreview
                              key={`${entry.id}-attachment-${attachmentIndex}-${attachment.name}`}
                              attachment={attachment}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mb-3">
                      <div className="mb-1 text-xs font-semibold text-gray-700">AI Response</div>
                      <div className="text-sm rounded-md bg-white border border-gray-200 p-2">
                        {entry.aiResponse ? <MarkdownRenderer content={entry.aiResponse} normalizeContent={normalizeRenderedContent} /> : <span className="text-gray-500">No AI response recorded</span>}
                      </div>
                    </div>
                    <div className="pt-2 border-t border-purple-200">
                      <div className="text-xs font-semibold text-purple-900 mb-1">Reflection</div>
                      <div className="text-xs text-purple-700 whitespace-pre-wrap break-words bg-purple-50 p-2 rounded">
                        {entry.reflection || 'No reflection provided'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Image Generation Dialog */}
      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="size-5 text-purple-600" />
              Generate Image with DALL-E
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900">
                Describe the image you want to generate
              </label>
              <p className="text-xs text-gray-600">
                Be specific and descriptive. For example: "A diagram showing the water cycle with labels" or "An illustration of a cell with all its organelles"
              </p>
              <Textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="e.g., A detailed illustration of photosynthesis process with labeled parts..."
                className="min-h-[120px]"
                disabled={isGeneratingImage}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowImageDialog(false);
                  setImagePrompt('');
                }}
                disabled={isGeneratingImage}
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerateImage}
                disabled={!imagePrompt.trim() || isGeneratingImage}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {isGeneratingImage ? (
                  <>
                    <span className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4 mr-2" />
                    Generate Image
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Clear Workspace Confirmation Dialog */}
      <Dialog open={showClearWorkspaceDialog} onOpenChange={setShowClearWorkspaceDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Clear Workspace</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-700">
              Are you sure you want to clear the workspace? This will remove all messages from the current view across future sign-ins on this device, while keeping them in the archive.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowClearWorkspaceDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={clearWorkspace}
              variant="default"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Clear Log Confirmation Dialog */}
      <Dialog open={showClearLogDialog} onOpenChange={setShowClearLogDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Clear All Messages</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-700">
              Are you sure you want to clear <strong>all</strong> messages? This action cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowClearLogDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={clearLog}
              className="bg-red-600 hover:bg-red-700"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
