import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Send, Brain, User, Sparkles, Archive, X, Download, ArrowDown, FileText, LogOut, Paperclip, File, Image as ImageIcon, Trash2, Eraser, Wand2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { ScrollArea } from './components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { motion } from 'motion/react';
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
  activityType?: 'user-activity' | 'ai-response' | 'image-request' | 'image-response' | 'system-error';
  aiProvider?: string;
  feedback?: string;
  attachments?: Array<{
    name: string;
    type: string;
    content?: string;
    preview?: string;
  }>;
}

// Memoized message component to prevent re-renders when input changes
const MessageItem = memo(({ 
  message, 
  onFeedbackChange 
}: { 
  message: Message;
  onFeedbackChange: (id: string, feedback: string) => void;
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
          <MarkdownRenderer content={message.content} />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {message.timestamp.toLocaleTimeString()}
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

const API_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-09672449`;
const getArchiveStorageKey = (userId: string) => `mydis_archive_${userId || 'guest'}`;

function normalizeMessage(raw: any): Message {
  return {
    ...raw,
    timestamp: new Date(raw.timestamp),
  };
}

function loadLocalArchive(userId: string): Message[] {
  if (!userId) return [];

  try {
    const stored = localStorage.getItem(getArchiveStorageKey(userId));
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeMessage).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  } catch (error) {
    console.error('Failed to load local archive:', error);
    return [];
  }
}

function persistLocalArchive(userId: string, messageList: Message[]) {
  if (!userId) return;

  try {
    localStorage.setItem(getArchiveStorageKey(userId), JSON.stringify(messageList));
  } catch (error) {
    console.error('Failed to persist local archive:', error);
  }
}

function mergeMessages(primary: Message[], secondary: Message[]): Message[] {
  const merged = new Map<string, Message>();

  [...primary, ...secondary].forEach((message) => {
    merged.set(message.id, message);
  });

  return Array.from(merged.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function formatArchiveTimestamp(timestamp: Date): string {
  return timestamp.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
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
  const [showClearLogDialog, setShowClearLogDialog] = useState(false);
  const [showClearWorkspaceDialog, setShowClearWorkspaceDialog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for existing session on load
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      
      if (session?.access_token) {
        const currentUserId = session.user?.id || 'guest';
        setAccessToken(session.access_token);
        setUserName(session.user?.user_metadata?.name || session.user?.email?.split('@')[0] || 'User');
        setUserId(currentUserId);
        const localMessages = loadLocalArchive(currentUserId);
        if (localMessages.length > 0) {
          setMessages(localMessages);
          setArchiveMessages(localMessages);
        }
        
        // Load messages for this user
        try {
          const response = await fetch(`${API_BASE_URL}/messages/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${publicAnonKey}` }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.messages && Array.isArray(data.messages)) {
              const loadedMessages = data.messages.map(normalizeMessage);
              const mergedMessages = mergeMessages(loadedMessages, localMessages);
              setMessages(mergedMessages);
              setArchiveMessages(mergedMessages);
              persistLocalArchive(currentUserId, mergedMessages);
              console.log(`✅ Loaded ${loadedMessages.length} messages on session restore`);
            }
          }
        } catch (error) {
          console.log('Failed to load messages:', error);
        }
        
        setIsAuthenticated(true);
      }
    };
    
    checkSession();
  }, []);

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
        const localMessages = loadLocalArchive(userId);
        if (localMessages.length > 0) {
          setArchiveMessages(localMessages);
        }
        try {
          const response = await fetch(`${API_BASE_URL}/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${publicAnonKey}` }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.messages && Array.isArray(data.messages)) {
              const loadedMessages = data.messages.map(normalizeMessage);
              const mergedMessages = mergeMessages(loadedMessages, localMessages);
              setArchiveMessages(mergedMessages);
              persistLocalArchive(userId, mergedMessages);
              console.log(`✅ Loaded ${loadedMessages.length} archive messages`);
            }
          }
        } catch (error) {
          console.log('Failed to load archive messages:', error);
        }
      }
    };
    
    loadArchiveMessages();
  }, [showArchive, userId]);

  // Callback for updating feedback
  const updateFeedback = useCallback(async (messageId: string, feedback: string) => {
    const applyFeedback = (list: Message[]) => list.map(msg =>
      msg.id === messageId ? { ...msg, feedback } : msg
    );

    setMessages(prev => {
      const next = applyFeedback(prev);
      persistLocalArchive(userId, next);
      return next;
    });
    setArchiveMessages(prev => {
      const next = applyFeedback(prev);
      persistLocalArchive(userId, next);
      return next;
    });
    
    // Save feedback to database
    try {
      await fetch(`${API_BASE_URL}/messages/${userId}/${messageId}/feedback`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`
        },
        body: JSON.stringify({ feedback })
      });
    } catch (error) {
      console.error('Failed to save feedback:', error);
    }
  }, [userId]);

  // Save a message to the database
  const saveMessage = useCallback(async (message: Message) => {
    const upsertMessage = (list: Message[]) => {
      const exists = list.some(existing => existing.id === message.id);
      const next = exists
        ? list.map(existing => existing.id === message.id ? message : existing)
        : [...list, message];
      return next.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    };

    setMessages(prev => {
      const next = upsertMessage(prev);
      persistLocalArchive(userId, next);
      return next;
    });
    setArchiveMessages(prev => {
      const next = upsertMessage(prev);
      persistLocalArchive(userId, next);
      return next;
    });

    try {
      await fetch(`${API_BASE_URL}/messages/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`
        },
        body: JSON.stringify(message)
      });
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  }, [userId]);

  const handleAuthSuccess = async (token: string, name: string) => {
    setAccessToken(token);
    setUserName(name);
    
    // Get userId FIRST before setting isAuthenticated
    let newUserId = '';
    if (token) {
      // Authenticated user - get user ID from session
      const { data: { session } } = await supabaseClient.auth.getSession();
      newUserId = session?.user?.id || 'guest';
    } else {
      // Guest mode
      newUserId = 'guest';
    }
    
    setUserId(newUserId);
    const localMessages = loadLocalArchive(newUserId);
    if (localMessages.length > 0) {
      setMessages(localMessages);
      setArchiveMessages(localMessages);
    }
    
    // Load messages for this user
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${newUserId}`, {
        headers: { 'Authorization': `Bearer ${publicAnonKey}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.messages && Array.isArray(data.messages)) {
          const loadedMessages = data.messages.map(normalizeMessage);
          const mergedMessages = mergeMessages(loadedMessages, localMessages);
          setMessages(mergedMessages);
          setArchiveMessages(mergedMessages);
          persistLocalArchive(newUserId, mergedMessages);
          console.log(`✅ Loaded ${loadedMessages.length} messages for user ${newUserId}`);
        }
      }
    } catch (error) {
      console.log('Failed to load messages:', error);
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
    setMessages([]);
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
      activityType: 'user-activity',
      aiProvider: 'User',
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ 
          message: currentInput, 
          conversationHistory: messages,
          files: currentFiles
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to get response`);
      }

      const data = await response.json();
      console.log('🔍 Received from API:', { hasIsIncorrect: 'isIncorrect' in data, isIncorrect: data.isIncorrect });
      console.log('📊 SERVER RESPONSE - isIncorrect flag:', data.isIncorrect);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        activityType: 'ai-response',
        aiProvider: 'OpenAI GPT-4o'
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
        activityType: 'system-error',
        aiProvider: 'OpenAI GPT-4o'
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
    const headers = ['Timestamp', 'Date', 'Time', 'Role', 'AI Provider', 'Content', 'Reflection'];
    const rows = archiveMessages.map(msg => {
      const date = msg.timestamp.toLocaleDateString();
      const time = msg.timestamp.toLocaleTimeString();
      const role = msg.role === 'user' ? 'You' : 'GenAI Support';
      const aiProvider = `"${(msg.aiProvider || (msg.role === 'user' ? 'User' : 'Unknown')).replace(/"/g, '""')}"`;
      const content = `"${msg.content.replace(/"/g, '""')}"`;
      const reflection = msg.feedback ? `"${msg.feedback.replace(/"/g, '""')}"` : '""';
      return [msg.timestamp.toISOString(), date, time, role, aiProvider, content, reflection].join(',');
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
            ...archiveMessages.map(msg => {
              const date = msg.timestamp.toLocaleDateString();
              const time = msg.timestamp.toLocaleTimeString();
              const role = msg.role === 'user' ? 'You' : 'GenAI Support';
              const provider = msg.aiProvider || (msg.role === 'user' ? 'User' : 'Unknown');
              const content = msg.content;
              const reflection = msg.feedback || 'No reflection provided';
              return new Paragraph({
                children: [
                  new TextRun({
                    text: `${date} ${time} - ${role} (${provider}): `,
                    bold: true,
                  }),
                  new TextRun(content),
                  new TextRun({
                    text: `\nReflection: ${reflection}\n`,
                    color: "7C3AED",
                  }),
                ],
              });
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

  const clearLog = async () => {
    setShowClearLogDialog(false);

    try {
      // Delete all messages from the database for this user
      const response = await fetch(`${API_BASE_URL}/messages/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`
        }
      });

      if (response.ok) {
        setMessages([]);
        setArchiveMessages([]);
        localStorage.removeItem(getArchiveStorageKey(userId));
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
    
    // Only clear the current messages state without deleting from database
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
      activityType: 'image-request',
      aiProvider: 'OpenAI DALL-E 3'
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
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
        activityType: 'image-response',
        aiProvider: 'OpenAI DALL-E 3'
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
        activityType: 'system-error',
        aiProvider: 'OpenAI DALL-E 3'
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

  const archiveQueryCount = archiveMessages.filter(
    msg => msg.activityType === 'user-activity' || msg.activityType === 'image-request' || msg.role === 'user'
  ).length;

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

            {/* Jump to Latest Button */}
            {messages.length > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={scrollToBottom}
                className="absolute bottom-24 right-6 size-12 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center group"
                title="Jump to Latest Message"
              >
                <ArrowDown className="size-5 group-hover:animate-bounce" />
              </motion.button>
            )}

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
              
              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={needsReflection ? "Please complete the reflection above to continue..." : "Describe your problem or ask a question..."}
                    className="flex-1 min-h-[60px]"
                    disabled={needsReflection}
                  />
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
                <Button onClick={handleSend} size="icon" className="size-[60px]" disabled={!canSendMessage}>
                  <Send className="size-5" />
                </Button>
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
                  <button onClick={() => setShowArchive(false)} className="size-8 rounded hover:bg-white/20 flex items-center justify-center" title="Close Archive">
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3">
                {archiveMessages.map((msg) => (
                  <div key={msg.id} className="p-3 mb-3 rounded-lg border bg-gray-50 border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-sm">
                        {msg.role === 'user' ? 'You' : 'GenAI Support'}
                      </div>
                      <div className="text-xs text-gray-500">{formatArchiveTimestamp(msg.timestamp)}</div>
                    </div>
                    <div className="mb-2">
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        msg.role === 'user'
                          ? 'bg-blue-100 text-blue-700'
                          : msg.activityType === 'system-error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {msg.activityType === 'image-request' ? 'User Activity: Image Request'
                            : msg.activityType === 'image-response' ? 'AI Response: Generated Image'
                            : msg.activityType === 'system-error' ? 'AI Response: Error'
                            : msg.role === 'user' ? 'User Activity'
                            : 'AI Response'}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                          Provider: {msg.aiProvider || (msg.role === 'user' ? 'User' : 'Unknown')}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm mb-2">
                      <MarkdownRenderer content={msg.content} />
                    </div>
                    {msg.feedback && (
                      <div className="mt-2 pt-2 border-t border-purple-200">
                        <div className="text-xs font-semibold text-purple-900 mb-1">💭 Reflection:</div>
                        <div className="text-xs text-purple-700 whitespace-pre-wrap break-words bg-purple-50 p-2 rounded">
                          {msg.feedback}
                        </div>
                      </div>
                    )}
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
              Are you sure you want to clear the workspace? This will remove all messages from the current view but keep them in the archive.
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
