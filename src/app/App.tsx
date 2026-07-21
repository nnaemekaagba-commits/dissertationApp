import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Send, Brain, User, Sparkles, Archive, X, ArrowDown, File as FileIcon, LogOut, Paperclip, FileDown, Image as ImageIcon, Trash2, Eraser, Wand2, Mic, MicOff, AudioLines, Square, Copy, Check, Bot, Globe2, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { ScrollArea } from './components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { motion } from 'motion/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicAnonKey } from '/utils/supabase/info';
import { API_BASE_URL, API_BACKEND_LABEL, CHAT_API_BASE_URL } from '/utils/api';
import { supabaseClient } from '/utils/supabase/client';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { AuthPage } from './components/AuthPage';

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}

interface CopyEvent {
  timestamp: Date;
  source: 'response' | 'selection' | 'code' | 'link';
  text: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  aiProvider?: string;
  provider?: ChatProvider;
  feedback?: string;
  attachments?: UploadedFile[];
  isIncorrect?: boolean;
  isConflicting?: boolean;
  copyEvents?: CopyEvent[];
}

interface UploadedFile {
  name: string;
  type: string;
  content: string;
  preview?: string;
  extractedText?: string;
  generated?: boolean;
}

interface ArchiveEntry {
  id: string;
  timestamp: Date;
  userQuery: string;
  aiProvider: string;
  aiProvidersUsed: string[];
  webSourcesUsed: boolean;
  webSourcesUsedCount: number;
  aiResponse: string;
  reflection: string;
  attachments?: Message['attachments'];
  isConflicting?: boolean;
  copyEvents?: CopyEvent[];
}

type ChatProvider = 'openai' | 'google' | 'claude';

interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
}

interface WebSearchData {
  query?: string;
  provider?: string;
  configured?: boolean;
  results?: WebSearchResult[];
  note?: string;
  error?: string;
}

interface ImageSearchResult {
  title: string;
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  source?: string;
  width?: number;
  height?: number;
}

interface ImageSearchData {
  query?: string;
  provider?: string;
  configured?: boolean;
  images?: ImageSearchResult[];
  note?: string;
  error?: string;
}

const reflectionQuestions = [
  'Are you satisfied with the response and why?',
  'How did you use this response in finding solution to the problem you want to solve?',
];

const parseReflectionAnswers = (feedback = '') =>
  reflectionQuestions.map((question, index) => {
    const answerStart = feedback.indexOf(`${question}\nAnswer:`);
    if (answerStart === -1) return '';

    const valueStart = answerStart + `${question}\nAnswer:`.length;
    const nextQuestion = reflectionQuestions[index + 1];
    const valueEnd = nextQuestion ? feedback.indexOf(`\n\n${nextQuestion}\nAnswer:`, valueStart) : -1;
    const rawAnswer = valueEnd === -1 ? feedback.slice(valueStart) : feedback.slice(valueStart, valueEnd);

    if (rawAnswer.startsWith('\n')) return rawAnswer.slice(1);
    if (rawAnswer.startsWith(' ')) return rawAnswer.slice(1);
    return rawAnswer;
  });

const formatReflectionAnswers = (answers: string[]) =>
  reflectionQuestions
    .map((question, index) => `${question}\nAnswer:\n${answers[index] || ''}`)
    .join('\n\n');

const isReflectionComplete = (feedback?: string) =>
  parseReflectionAnswers(feedback).every((answer) => answer.trim().length > 0);

const conflictResponsePattern =
  /(conflicting|contradictory|contradiction|alternative|counterargument|competing).{0,80}(response|interpretation|method|view|assumption|claim|answer)/i;

const hasConflictingResponse = (message: Pick<Message, 'content' | 'isConflicting' | 'isIncorrect'>) =>
  Boolean(
    message.isConflicting ||
      message.isIncorrect ||
      conflictResponsePattern.test(message.content || '') ||
      (/primary response/i.test(message.content || '') &&
        (/conflicting or alternative response/i.test(message.content || '') || /contradictory response/i.test(message.content || '')))
  );

const archiveIncorrectPattern = /\[\[ARCHIVE_INCORRECT\]\]([\s\S]*?)\[\[\/ARCHIVE_INCORRECT\]\]/g;

const stripArchiveIncorrectMarkers = (content = '') =>
  content
    .replace(/\[\[ARCHIVE_INCORRECT\]\]/g, '')
    .replace(/\[\[\/ARCHIVE_INCORRECT\]\]/g, '');

const sanitizeMessageForRemoteSave = (message: Message): Message => ({
  ...message,
  attachments: message.attachments?.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    content: '',
    preview: undefined,
    extractedText: attachment.extractedText,
  })),
});

const dataImageMarkdownPattern = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g;

const sanitizeMessageForLocalArchive = (message: Message): Message => ({
  ...message,
  content: message.content
    .replace(dataImageMarkdownPattern, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim(),
  attachments: message.attachments?.map((attachment) =>
    attachment.generated
      ? {
          ...attachment,
          content: '',
          preview: undefined,
        }
      : attachment
  ),
});

const sanitizeConversationHistoryForChat = (history: Message[]): Message[] =>
  history.map((message) => sanitizeMessageForRemoteSave(message));

const getBase64PayloadLength = (value: string) => {
  const markerIndex = value.indexOf(',');
  return markerIndex >= 0 ? value.length - markerIndex - 1 : value.length;
};

const getApproxPayloadBytes = (value: unknown) => new Blob([JSON.stringify(value)]).size;

const compressImageForAI = async (file: UploadedFile): Promise<UploadedFile> => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  const originalBytes = getBase64PayloadLength(file.content);
  const targetBytes = 3 * 1024 * 1024;

  if (originalBytes <= targetBytes && file.type === 'image/jpeg') {
    return file;
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = file.content;
  });

  const makeCompressedImage = (maxSide: number, quality: number) => {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
  };

  const attempts = [
    { maxSide: 1800, quality: 0.82 },
    { maxSide: 1600, quality: 0.76 },
    { maxSide: 1400, quality: 0.68 },
    { maxSide: 1200, quality: 0.6 },
    { maxSide: 1000, quality: 0.54 },
  ];

  let bestContent: string | null = null;

  for (const attempt of attempts) {
    const compressedContent = makeCompressedImage(attempt.maxSide, attempt.quality);
    if (!compressedContent) return file;
    if (getBase64PayloadLength(compressedContent) >= originalBytes) continue;
    bestContent = compressedContent;
    if (getBase64PayloadLength(compressedContent) <= targetBytes) break;
  }

  return bestContent
    ? { name: file.name.replace(/\.[^.]+$/, '.jpg'), type: 'image/jpeg', content: bestContent }
    : file;
};

const CHAT_PROVIDER_OPTIONS: Array<{ id: ChatProvider; label: string }> = [
  { id: 'openai', label: 'AI x' },
  { id: 'google', label: 'AI y' },
  { id: 'claude', label: 'AI z' },
];

const CHAT_PROVIDER_LABELS: Record<ChatProvider, string> = {
  openai: 'Ax',
  google: 'Ay',
  claude: 'Az',
};
const normalizeChatProvider = (provider?: string | null): ChatProvider | undefined => {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;

  const directMatch = CHAT_PROVIDER_OPTIONS.find((option) =>
    option.id === value || option.label.toLowerCase() === value
  );
  if (directMatch) return directMatch.id;

  const providerLabelMatch = CHAT_PROVIDER_OPTIONS.find((option) =>
    CHAT_PROVIDER_LABELS[option.id].toLowerCase() === value
  );
  if (providerLabelMatch) return providerLabelMatch.id;

  if (value.includes('openai') || value.includes('gpt')) return 'openai';
  if (value.includes('google') || value.includes('gemini')) return 'google';
  if (value.includes('claude') || value.includes('anthropic')) return 'claude';

  return undefined;
};

const getChatProviderDisplayLabel = (provider?: string | null): string | undefined => {
  const providerId = normalizeChatProvider(provider);
  return providerId ? CHAT_PROVIDER_LABELS[providerId] : provider || undefined;
};

const getAlternateChatProvider = (sourceProvider?: string | null): ChatProvider => {
  const sourceProviderId = normalizeChatProvider(sourceProvider);
  const providerOrder: ChatProvider[] = ['claude', 'google', 'openai'];
  return providerOrder.find((provider) => provider !== sourceProviderId) || 'openai';
};

const IMAGE_PROVIDER_LABEL = 'OpenAI Image';
const WEB_SOURCE_PROVIDER_LABEL = 'External Web Sources';
const IMAGE_SEARCH_PROVIDER_LABEL = 'Internet Images';
const buildImageSearchLinks = (query: string) => {
  const encodedQuery = encodeURIComponent(query);
  return [
    `[Google Images](https://www.google.com/search?tbm=isch&q=${encodedQuery})`,
    `[Bing Images](https://www.bing.com/images/search?q=${encodedQuery})`,
    `[Wikimedia Commons](https://commons.wikimedia.org/w/index.php?search=${encodedQuery}&title=Special:MediaSearch&type=image)`,
  ].join(' | ');
};

const escapeMarkdownText = (value = '') =>
  value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');

const formatWebSearchResults = (data: WebSearchData, fallbackQuery: string) => {
  const query = data.query || fallbackQuery;
  const results = Array.isArray(data.results) ? data.results.filter((result) => result?.url) : [];
  const intro =
    data.configured === false
      ? `## External web sources\n\nNo live search provider is configured yet. Use these direct web searches for: **${escapeMarkdownText(query)}**.`
      : `## External web sources\n\nI found ${results.length} source${results.length === 1 ? '' : 's'} for: **${escapeMarkdownText(query)}**.`;

  const resultText = results
    .map((result, index) => {
      const title = escapeMarkdownText(result.title || result.url);
      const source = result.source ? ` _${escapeMarkdownText(result.source)}_` : '';
      const snippet = result.snippet ? `\n   ${escapeMarkdownText(result.snippet)}` : '';
      return `${index + 1}. [${title}](${result.url})${source}${snippet}`;
    })
    .join('\n\n');

  return [
    intro,
    resultText || 'No source results were returned.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

const formatImageSearchResults = (data: ImageSearchData, fallbackQuery: string) => {
  const query = data.query || fallbackQuery;
  const images = Array.isArray(data.images) ? data.images.filter((image) => image?.imageUrl) : [];
  const intro =
    data.configured === false
      ? `## Internet image results\n\nI could not pull hosted image thumbnails automatically yet for: **${escapeMarkdownText(query)}**.`
      : `## Internet image results\n\nI found ${images.length} image${images.length === 1 ? '' : 's'} for: **${escapeMarkdownText(query)}**.`;

  const resultText = images
    .map((image, index) => {
      const title = escapeMarkdownText(image.title || `Image result ${index + 1}`);
      const source = image.source ? ` _${escapeMarkdownText(image.source)}_` : '';
      const sourceLink = image.sourceUrl ? ` [Open source](${image.sourceUrl})` : '';
      return `${index + 1}. **${title}**${source}${sourceLink}`;
    })
    .join('\n\n');

  return [
    intro,
    data.note ? escapeMarkdownText(data.note) : '',
    resultText || `No image thumbnails were returned. Open direct image searches: ${buildImageSearchLinks(query)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
};

const formatTimestamp = (timestamp: Date) =>
  timestamp.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatPromptCount = (count: number) => `${count} ${count === 1 ? 'prompt' : 'prompts'}`;

const MAX_COPY_LOG_TEXT_LENGTH = 2000;

const normalizeCopiedText = (text = '') => {
  const normalized = text.trim();
  if (normalized.length <= MAX_COPY_LOG_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_COPY_LOG_TEXT_LENGTH)}...`;
};

const mergeCopyEvents = (...groups: Array<CopyEvent[] | undefined>) => {
  const seen = new Set<string>();

  return groups.flatMap((group) => group || []).filter((event) => {
    const timestamp = event.timestamp instanceof Date ? event.timestamp.getTime() : new Date(event.timestamp).getTime();
    const key = `${timestamp}|${event.source}|${event.text}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const formatCopySource = (source: CopyEvent['source']) => {
  if (source === 'response') return 'Full AI response copied';
  if (source === 'code') return 'Code block copied';
  if (source === 'link') return 'Hyperlink clicked';
  return 'Selected AI response text copied';
};

const addUniqueProvider = (providers: string[] = [], provider?: string) => {
  if (!provider || provider === WEB_SOURCE_PROVIDER_LABEL) {
    return providers;
  }

  return providers.includes(provider) ? providers : [...providers, provider];
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const mergeAudioBuffers = (chunks: Float32Array[]) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });

  return result;
};

const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
};

const isSupportedAudioInput = (file: UploadedFile) => {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/mpeg' || type === 'audio/mp3' || name.endsWith('.wav') || name.endsWith('.mp3');
};

const getArchiveStorageKey = (currentUserId: string) => `mydis-archive:${currentUserId}`;
const getWorkspaceClearStorageKey = (currentUserId: string) => `mydis-workspace-cleared-at:${currentUserId}`;
const GUEST_USER_ID = 'guest';

const normalizeMessages = (rawMessages: any[] | undefined): Message[] => {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages.map((msg) => ({
    ...msg,
    timestamp: new Date(msg.timestamp),
    copyEvents: Array.isArray(msg.copyEvents)
      ? msg.copyEvents.map((event: CopyEvent) => ({
          ...event,
          timestamp: new Date(event.timestamp),
        }))
      : undefined,
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

  if (attachment.type.startsWith('audio/')) {
    return `${header}\nAudio uploaded. Playable in the archive interface and sent to the AI provider when supported.`;
  }

  if (attachment.type === 'application/pdf') {
    return `${header}\nPDF uploaded. Openable from the archive interface.${attachment.extractedText ? `\n\nExtracted text:\n${normalizePrintableText(attachment.extractedText)}` : ''}`;
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
    const isAudio = attachment.type.startsWith('audio/');
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
    } else if (isAudio && attachment.content) {
      previewMarkup = `
        <audio class="attachment-audio" controls src="${attachment.content}">
          Audio preview is not available in this browser's print view.
        </audio>
      `;
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

const ArchiveResponseRenderer = ({
  content,
  normalizeContent,
}: {
  content: string;
  normalizeContent: boolean;
}) => {
  const segments: Array<{ content: string; incorrect: boolean }> = [];
  let lastIndex = 0;

  content.replace(archiveIncorrectPattern, (match, markedContent, offset) => {
    if (offset > lastIndex) {
      segments.push({ content: content.slice(lastIndex, offset), incorrect: false });
    }

    segments.push({ content: markedContent, incorrect: true });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < content.length) {
    segments.push({ content: content.slice(lastIndex), incorrect: false });
  }

  return (
    <div className="archive-response-renderer">
      {(segments.length ? segments : [{ content, incorrect: false }]).map((segment, index) => {
        const cleanContent = stripArchiveIncorrectMarkers(segment.content);
        if (!cleanContent.trim()) return null;

        return (
          <div
            key={`${segment.incorrect ? 'incorrect' : 'correct'}-${index}`}
            className={segment.incorrect ? 'archive-incorrect-text' : undefined}
          >
            <MarkdownRenderer content={cleanContent} normalizeContent={normalizeContent} />
          </div>
        );
      })}
    </div>
  );
};

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
        aiProvidersUsed: addUniqueProvider([], message.aiProvider),
        webSourcesUsed: false,
        webSourcesUsedCount: 0,
        aiResponse: '',
        reflection: '',
        attachments: message.attachments,
        isConflicting: hasConflictingResponse(message),
        copyEvents: message.copyEvents || [],
      };
      return;
    }

    if (!pendingEntry) {
      pendingEntry = {
        id: message.id,
        timestamp: message.timestamp,
        userQuery: '',
        aiProvider: message.aiProvider || 'Provider not recorded',
        aiProvidersUsed: addUniqueProvider([], message.aiProvider),
        webSourcesUsed: message.aiProvider === WEB_SOURCE_PROVIDER_LABEL,
        webSourcesUsedCount: message.aiProvider === WEB_SOURCE_PROVIDER_LABEL ? 1 : 0,
        aiResponse: message.content,
        reflection: message.feedback || '',
        attachments: message.attachments,
        isConflicting: hasConflictingResponse(message),
        copyEvents: message.copyEvents || [],
      };
      entries.push(pendingEntry);
      pendingEntry = null;
      return;
    }

    pendingEntry = {
      ...pendingEntry,
      aiProvider: addUniqueProvider(pendingEntry.aiProvidersUsed, message.aiProvider).join(', ') || message.aiProvider || pendingEntry.aiProvider,
      aiProvidersUsed: addUniqueProvider(pendingEntry.aiProvidersUsed, message.aiProvider),
      webSourcesUsed: Boolean(pendingEntry.webSourcesUsed || message.aiProvider === WEB_SOURCE_PROVIDER_LABEL),
      webSourcesUsedCount: pendingEntry.webSourcesUsedCount + (message.aiProvider === WEB_SOURCE_PROVIDER_LABEL ? 1 : 0),
      attachments: pendingEntry.attachments || message.attachments,
      aiResponse: pendingEntry.aiResponse
        ? `${pendingEntry.aiResponse}\n\n${message.content}`
        : message.content,
      reflection: message.feedback || pendingEntry.reflection,
      isConflicting: Boolean(pendingEntry.isConflicting || hasConflictingResponse(message)),
      copyEvents: mergeCopyEvents(pendingEntry.copyEvents, message.copyEvents),
    };
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
      isIncorrect: message.isIncorrect ?? existing.isIncorrect,
      isConflicting: message.isConflicting ?? existing.isConflicting,
      copyEvents: mergeCopyEvents(existing.copyEvents, message.copyEvents),
      timestamp: message.timestamp || existing.timestamp,
    });
  });

  return sortMessagesByTime(Array.from(mergedMessages.values()));
};

const findPreviousUserPrompt = (messages: Message[], messageIndex: number) => {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return stripArchiveIncorrectMarkers(messages[index].content).trim();
    }
  }

  return '';
};

// Memoized message component to prevent re-renders when input changes
const MessageItem = memo(({ 
  message, 
  sourcePrompt,
  onFeedbackChange,
  onCopyLog,
  onCompareWithAnotherAI,
  onViewExternalSources,
  normalizeContent
}: { 
  message: Message;
  sourcePrompt?: string;
  onFeedbackChange: (id: string, feedback: string) => void;
  onCopyLog: (id: string, source: CopyEvent['source'], copiedText: string) => void;
  onCompareWithAnotherAI: (sourcePrompt: string, responseContent: string, sourceProvider: string | undefined, sourceMessageId: string) => void;
  onViewExternalSources: (sourcePrompt: string, responseContent: string, sourceMessageId: string) => void;
  normalizeContent: boolean;
}) => {
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [reflectionDrafts, setReflectionDrafts] = useState(() => parseReflectionAnswers(message.feedback || ''));
  const displayContent = stripArchiveIncorrectMarkers(message.content);
  const hasSourcePrompt = Boolean(sourcePrompt?.trim());

  useEffect(() => {
    setReflectionDrafts(parseReflectionAnswers(message.feedback || ''));
  }, [message.id, message.feedback]);

  const copyResponse = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      onCopyLog(message.id, 'response', displayContent);
      setCopiedResponse(true);
      window.setTimeout(() => setCopiedResponse(false), 1600);
    } catch {
      setCopiedResponse(false);
    }
  };

  const logSelectedCopy = () => {
    if (message.role !== 'assistant') return;
    onCopyLog(message.id, 'selection', window.getSelection()?.toString() || '');
  };

  const logMarkdownCopy = (text: string, source: 'code') => {
    if (message.role !== 'assistant') return;
    onCopyLog(message.id, source, text);
  };

  const logLinkClick = (label: string, href: string) => {
    if (message.role !== 'assistant') return;
    onCopyLog(message.id, 'link', `Hypertext: ${label || href}\nURL: ${href}`);
  };

  return (
    <div
      key={message.id}
      id={`message-${message.id}`}
      className={`message-row flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : 'assistant-row'}`}
    >
      <div className={`size-7 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-blue-600' : 'bg-purple-600'}`}>
        {message.role === 'user' ? <User className="size-3.5 text-white" /> : <Sparkles className="size-3.5 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={message.role === 'user' ? 'user-message-surface font-bold' : 'assistant-message-surface'}
          onCopy={message.role === 'assistant' ? logSelectedCopy : undefined}
        >
          {message.role === 'assistant' && (
            <div className="assistant-response-toolbar">
              <div className="assistant-response-heading">
                <span className="assistant-response-label">AI response</span>
              </div>
              <button
                type="button"
                className="assistant-copy-button"
                onClick={copyResponse}
                title="Copy response"
                aria-label="Copy response"
              >
                {copiedResponse ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </div>
          )}
          <MarkdownRenderer
            content={displayContent}
            normalizeContent={normalizeContent}
            onCopyContent={message.role === 'assistant' ? logMarkdownCopy : undefined}
            onLinkClick={message.role === 'assistant' ? logLinkClick : undefined}
          />
          {message.role === 'assistant' && hasSourcePrompt && (
            <div className="source-review-actions" aria-label="Review response sources">
              <button
                type="button"
                className="source-review-link source-review-ai"
                onClick={() => onCompareWithAnotherAI(sourcePrompt || '', displayContent, message.provider || message.aiProvider, message.id)}
              >
                <Bot className="size-4" />
                <span>Ask another AI</span>
              </button>
              <button
                type="button"
                className="source-review-link source-review-web"
                onClick={() => onViewExternalSources(sourcePrompt || '', displayContent, message.id)}
              >
                <Globe2 className="size-4" />
                <span>View external web sources</span>
              </button>
            </div>
          )}
          {message.attachments?.some((attachment) => attachment.type.startsWith('image/') && attachment.preview) && (
            <div className="mt-4 space-y-3">
              {message.attachments
                .filter((attachment) => attachment.type.startsWith('image/') && attachment.preview)
                .map((attachment, index) => (
                  <img
                    key={`${message.id}-generated-image-${index}`}
                    src={attachment.preview}
                    alt={attachment.name || 'Generated image'}
                    className="max-h-[640px] w-full rounded-lg border border-slate-200 object-contain shadow-sm"
                    loading="lazy"
                  />
                ))}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {message.aiProvider ? `${message.aiProvider} · ` : ''}
          {formatTimestamp(message.timestamp)}
        </div>
        
        {false && message.role === 'assistant' && (
          <div className="mt-2">
            <div className="bg-gradient-to-r from-purple-100 to-pink-100 border border-purple-300 rounded-md p-2.5">
              <label className="block text-xs font-semibold text-purple-900 mb-1">
                💭 Reflection
              </label>
              <div className="reflection-questions">
                {reflectionQuestions.map((question, index) => {
                  return (
                    <label key={question} className="reflection-question-field">
                      <span>{question}</span>
                      <Textarea
                        value={reflectionDrafts[index] || ''}
                        onChange={(e) => {
                          const nextAnswers = [...reflectionDrafts];
                          nextAnswers[index] = e.target.value;
                          setReflectionDrafts(nextAnswers);
                          onFeedbackChange(message.id, formatReflectionAnswers(nextAnswers));
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        onKeyUp={(e) => e.stopPropagation()}
                        placeholder=""
                        className="min-h-[92px] resize-y bg-white text-sm font-normal leading-5 text-slate-900 border-purple-300 focus:border-purple-600 focus:ring-purple-600"
                      />
                    </label>
                  );
                })}
              </div>
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
  const isAudio = attachment.type.startsWith('audio/');
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

      {isAudio && attachment.content && (
        <audio
          controls
          src={attachment.content}
          className="w-full"
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

      {!isImage && !isAudio && !isPdf && !isTextLike && !isDocx && (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
          Preview is not available for this file type in the archive. Use the Open link to view it.
        </div>
      )}
    </div>
  );
};

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
  const [showImageSearchDialog, setShowImageSearchDialog] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>('openai');
  const selectedProviderRef = useRef<ChatProvider>('openai');
  const selectChatProvider = (provider: ChatProvider) => {
    selectedProviderRef.current = provider;
    setSelectedProvider(provider);
  };
  const [normalizeRenderedContent, setNormalizeRenderedContent] = useState(false);
  const [showClearLogDialog, setShowClearLogDialog] = useState(false);
  const [showClearWorkspaceDialog, setShowClearWorkspaceDialog] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioRecordingError, setAudioRecordingError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseInputRef = useRef('');
  const audioRecorderRef = useRef<{
    stream: MediaStream;
    audioContext: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    chunks: Float32Array[];
    sampleRate: number;
  } | null>(null);

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
      const compactMessages = nextMessages.map((message) => sanitizeMessageForLocalArchive(message));
      localStorage.setItem(getArchiveStorageKey(currentUserId), JSON.stringify(compactMessages));
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

  const clearLocalArchiveState = useCallback((currentUserId: string) => {
    setMessages([]);
    setArchiveMessages([]);
    persistArchive(currentUserId, []);
    resetWorkspaceClearedAt(currentUserId);
  }, [persistArchive, resetWorkspaceClearedAt]);

  const resolveAuthenticatedUser = useCallback(async (
    token: string,
    fallbackName: string,
    authUser?: { id?: string; email?: string | null }
  ) => {
    if (!token) {
      return {
        id: GUEST_USER_ID,
        email: '',
        name: fallbackName || 'Guest',
      };
    }

    let resolvedId = authUser?.id || '';
    let resolvedEmail = authUser?.email || '';
    let resolvedName = fallbackName;

    if (!resolvedId || !resolvedEmail) {
      const { data, error } = await supabaseClient.auth.getUser(token);
      if (error) {
        console.error('Failed to resolve authenticated user from token:', error);
      } else if (data.user) {
        resolvedId = resolvedId || data.user.id || '';
        resolvedEmail = resolvedEmail || data.user.email || '';
        resolvedName =
          resolvedName ||
          data.user.user_metadata?.name ||
          data.user.email?.split('@')[0] ||
          fallbackName;
      }
    }

    if (!resolvedId) {
      throw new Error('Unable to determine authenticated user id');
    }

    return {
      id: resolvedId,
      email: resolvedEmail,
      name: resolvedName || fallbackName,
    };
  }, []);

  // Check for existing session on load
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      
      if (session?.access_token) {
        const currentUserId = session.user?.id;
        if (!currentUserId) {
          console.error('Authenticated session missing user id; skipping archive restore.');
          return;
        }
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

  useEffect(() => {
    setSpeechSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));

    return () => {
      recognitionRef.current?.abort();
      audioRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      audioRecorderRef.current?.audioContext.close();
    };
  }, []);

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
        body: JSON.stringify(sanitizeMessageForRemoteSave(message))
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Failed to save message remotely:', errorData?.error || response.statusText);
      }
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  }, [buildApiHeaders, userId, upsertArchiveMessage]);

  const recordCopyEvent = useCallback((messageId: string, source: CopyEvent['source'], copiedText: string) => {
    const text = normalizeCopiedText(copiedText);
    if (!text) return;

    const event: CopyEvent = {
      timestamp: new Date(),
      source,
      text,
    };
    let updatedMessage: Message | null = null;

    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;

        updatedMessage = {
          ...message,
          copyEvents: mergeCopyEvents(message.copyEvents, [event]),
        };

        return updatedMessage;
      })
    );

    if (userId) {
      setArchiveMessages((prev) => {
        const nextMessages = prev.map((message) =>
          message.id === messageId
            ? { ...message, copyEvents: mergeCopyEvents(message.copyEvents, [event]) }
            : message
        );
        persistArchive(userId, nextMessages);
        return nextMessages;
      });
    }

    window.setTimeout(() => {
      if (updatedMessage) {
        void saveMessage(updatedMessage);
      }
    }, 0);
  }, [persistArchive, saveMessage, userId]);

  const handleAuthSuccess = async (
    token: string,
    name: string,
    authUser?: { id?: string; email?: string | null }
  ) => {
    const resolvedUser = await resolveAuthenticatedUser(token, name, authUser);

    setAccessToken(token);
    setUserName(resolvedUser.name);
    setUserEmail(resolvedUser.email);
    setUserId(resolvedUser.id);

    const newUserId = resolvedUser.id;
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

    const newFiles: UploadedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileType = file.type;
      const fileName = file.name.toLowerCase();
      const isPdf = fileType === 'application/pdf' || fileName.endsWith('.pdf');
      
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
        } else if (isPdf) {
          const content = await blobToDataUrl(file);
          newFiles.push({
            name: file.name,
            type: 'application/pdf',
            content,
          });
        } else if (
          fileType.startsWith('audio/') ||
          fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          // Handle binary files - convert to base64
          const content = await blobToDataUrl(file);
          newFiles.push({ name: file.name, type: fileType, content });
        } else if (
          fileType.startsWith('text/') ||
          fileType === 'application/json' ||
          fileType === 'application/javascript' ||
          fileType === 'application/x-python' ||
          fileName.endsWith('.txt') ||
          fileName.endsWith('.md') ||
          fileName.endsWith('.csv') ||
          fileName.endsWith('.py') ||
          fileName.endsWith('.js') ||
          fileName.endsWith('.java') ||
          fileName.endsWith('.cpp') ||
          fileName.endsWith('.c') ||
          fileName.endsWith('.html') ||
          fileName.endsWith('.css')
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
          alert(`File type "${fileType || 'unknown'}" for "${file.name}" is not supported. Please upload audio, images, PDFs, Word documents, or text files.`);
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

  const getPromptImageAction = (prompt: string): 'generate' | 'search' | null => {
    const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!normalized) return null;

    const internetImagePatterns = [
      /\b(pull|find|search|get|show|look up|fetch)\b.{0,50}\b(images?|pictures?|photos?)\b.{0,50}\b(internet|web|online|from the internet|from online)\b/,
      /\b(internet|web|online)\b.{0,30}\b(images?|pictures?|photos?)\b/,
      /\b(images?|pictures?|photos?)\b.{0,30}\b(from the internet|from online|on the web|online)\b/,
      /\b(find|search|get|show|pull|fetch)\b.{0,40}\b(images?|pictures?|photos?)\b\s+(of|for|about)\b/,
    ];

    if (internetImagePatterns.some((pattern) => pattern.test(normalized))) {
      return 'search';
    }

    const generatedImagePatterns = [
      /\b(generate|create|make|draw|produce|design)\b.{0,50}\b(images?|pictures?|photos?|illustrations?|diagrams?|visuals?)\b/,
      /\b(images?|pictures?|photos?|illustrations?|diagrams?|visuals?)\b.{0,30}\b(generate|create|make|draw|produce|design)\b/,
      /\b(ai[-\s]?generated|generate an?|create an?|make an?|draw an?)\b.{0,40}\b(image|picture|photo|illustration|diagram|visual)\b/,
      /^(an?\s+)?(image|picture|photo|illustration|diagram|visual)\s+(of|showing|with)\b/,
      /^([a-z0-9][\w'�-]*\s+){0,8}(image|picture|photo|illustration|diagram|visual)s?$/,
      /\b(i\s+need|i\s+want|show\s+me|give\s+me|can\s+you\s+make|can\s+you\s+create)\b.{0,35}\b(an?\s+)?(image|picture|photo|illustration|diagram|visual)\s+(of|showing|with)\b/,
    ];

    return generatedImagePatterns.some((pattern) => pattern.test(normalized)) ? 'generate' : null;
  };
  const handleSend = async (options?: {
    displayInput?: string;
    requestInput?: string;
    provider?: ChatProvider;
    skipUserMessage?: boolean;
    insertAfterMessageId?: string;
    comparisonResponse?: boolean;
  }) => {
    const displayInput = options?.displayInput ?? input;
    const requestInput = options?.requestInput ?? displayInput;
    const requestProvider = normalizeChatProvider(options?.provider) ?? selectedProviderRef.current;
    const activeUploadedFiles = options?.requestInput ? [] : uploadedFiles;

    if (!displayInput.trim() && activeUploadedFiles.length === 0) return;

    if (!options && activeUploadedFiles.length === 0) {
      const imageAction = getPromptImageAction(displayInput);

      if (imageAction === 'generate') {
        await runImageGeneration(displayInput);
        return;
      }

      if (imageAction === 'search') {
        await runInternetImageSearch(displayInput);
        return;
      }
    }

    if (isListening) {
      recognitionRef.current?.stop();
    }

    const audioFiles = activeUploadedFiles.filter((file) => file.type.startsWith('audio/'));
    const unsupportedAudioFile = audioFiles.find((file) => !isSupportedAudioInput(file));

    if (unsupportedAudioFile) {
      alert(`Audio file "${unsupportedAudioFile.name}" cannot be sent to the AI as audio. Please use WAV or MP3 audio.`);
      return;
    }

    if (audioFiles.length > 0 && requestProvider === 'claude') {
      alert('Claude does not currently support raw audio input through this app. Please select OpenAI or Google AI, or remove the audio attachment.');
      return;
    }

    // Build message content with files
    let messageContent = displayInput;
    let requestContent = requestInput;
    const fileContents: UploadedFile[] = [];
    
    if (activeUploadedFiles.length > 0) {
      messageContent += '\n\n**Attached Files:**\n';
      requestContent += '\n\n**Attached Files:**\n';
      for (const [index, file] of activeUploadedFiles.entries()) {
        if (file.type.startsWith('image/')) {
          messageContent += `\n${index + 1}. Image: ${file.name}`;
          requestContent += `\n${index + 1}. Image: ${file.name}`;
          fileContents.push(await compressImageForAI(file));
        } else if (file.type.startsWith('audio/')) {
          messageContent += `\n${index + 1}. Audio: ${file.name}`;
          requestContent += `\n${index + 1}. Audio: ${file.name}`;
          fileContents.push({ name: file.name, type: file.type, content: file.content });
        } else if (file.type.startsWith('text/') || file.type === 'application/json') {
          messageContent += `\n${index + 1}. ${file.name}:\n\`\`\`\n${file.content}\n\`\`\``;
          requestContent += `\n${index + 1}. ${file.name}:\n\`\`\`\n${file.content}\n\`\`\``;
        } else if (file.type === 'application/pdf') {
          messageContent += `\n${index + 1}. PDF Document: ${file.name}`;
          requestContent += `\n${index + 1}. PDF Document: ${file.name}`;
          if (file.extractedText) {
            messageContent += `\nExtracted text:\n\`\`\`\n${file.extractedText}\n\`\`\``;
            requestContent += `\nExtracted text:\n\`\`\`\n${file.extractedText}\n\`\`\``;
          }
          fileContents.push(file);
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          messageContent += `\n${index + 1}. Word Document: ${file.name}`;
          requestContent += `\n${index + 1}. Word Document: ${file.name}`;
          fileContents.push({ name: file.name, type: file.type, content: file.content });
        } else {
          messageContent += `\n${index + 1}. File: ${file.name}`;
          requestContent += `\n${index + 1}. File: ${file.name}`;
        }
      }
    }

    const userMessage: Message | null = options?.skipUserMessage ? null : {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      aiProvider: CHAT_PROVIDER_LABELS[requestProvider],
      attachments: activeUploadedFiles.length > 0 ? activeUploadedFiles : undefined,
      provider: requestProvider
    };

    const currentInput = requestContent;
    const currentFiles = fileContents;
    const conversationHistory = sanitizeConversationHistoryForChat(messages);
    const chatPayload = {
      message: currentInput,
      conversationHistory,
      files: currentFiles,
      provider: requestProvider,
    };
    const maxGatewayPayloadBytes = 9_000_000;

    if (getApproxPayloadBytes(chatPayload) > maxGatewayPayloadBytes) {
      alert('This file is too large to send through the current AWS API Gateway connection. Please try a smaller PDF/image, split the PDF, or compress the image before uploading.');
      return;
    }

    const insertAssistantMessage = (message: Message) => {
      setMessages((prev) => {
        if (!options?.insertAfterMessageId) return [...prev, message];

        const sourceIndex = prev.findIndex((item) => item.id === options.insertAfterMessageId);
        if (sourceIndex === -1) return [...prev, message];

        return [
          ...prev.slice(0, sourceIndex + 1),
          message,
          ...prev.slice(sourceIndex + 1),
        ];
      });
      saveMessage(message);
      if (options?.insertAfterMessageId) {
        scrollToMessage(message.id);
      }
    };

    if (userMessage) {
      setMessages(prev => [...prev, userMessage]);
      saveMessage(userMessage);
      setInput('');
      setUploadedFiles([]);
    }
    setIsTyping(true);

    try {
      const response = await fetch(`${CHAT_API_BASE_URL}/chat`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify(chatPayload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errorData: { error?: string } = {};
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = {};
        }
        const responseDetail = errorData.error || responseText.slice(0, 240) || response.statusText || 'Failed to get response';
        throw new Error(`HTTP ${response.status}: ${responseDetail}`);
      }

      const data = await response.json();
      const isConflicting = Boolean(data.isConflicting ?? data.isIncorrect);
      console.log('Received from API:', {
        hasIsConflicting: 'isConflicting' in data,
        isConflicting,
        hasIsIncorrect: 'isIncorrect' in data,
        isIncorrect: data.isIncorrect,
      });
      console.log('SERVER RESPONSE - conflict flag:', isConflicting);
      const providerUsedId = normalizeChatProvider(data.providerUsed) ?? requestProvider;
      const providerUsed = CHAT_PROVIDER_LABELS[providerUsedId];
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: options?.comparisonResponse ? `## ${providerUsed} response

${data.response}` : data.response,
        timestamp: new Date(),
        aiProvider: providerUsed,
        provider: providerUsedId,
        isIncorrect: data.isIncorrect,
        isConflicting,
      };
      
      insertAssistantMessage(assistantMessage);
    } catch (error) {
      console.error('Error during AI request:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ **Error**: Sorry, there was an error processing your request.\n\n**Details**: ${errorMessage}`,
        timestamp: new Date(),
        aiProvider: CHAT_PROVIDER_LABELS[requestProvider],
        provider: requestProvider
      };
      insertAssistantMessage(assistantMessage);
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

  const toggleVoiceInput = () => {
    if (needsReflection) {
      return;
    }

    if (isRecordingAudio) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setSpeechError('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    speechBaseInputRef.current = input.trim();
    setSpeechError('');

    let finalTranscript = '';

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interimTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;

        if (event.results[index].isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      const dictatedText = `${finalTranscript} ${interimTranscript}`.trim();
      const baseInput = speechBaseInputRef.current;
      setInput([baseInput, dictatedText].filter(Boolean).join(' '));
    };

    recognition.onerror = (event) => {
      setSpeechError(event.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Voice input stopped unexpectedly.');
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      setIsListening(true);
    } catch (error) {
      console.error('Failed to start voice input:', error);
      setSpeechError('Voice input could not be started.');
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  const stopAudioRecording = async () => {
    const recorder = audioRecorderRef.current;
    if (!recorder) {
      return;
    }

    audioRecorderRef.current = null;
    setIsRecordingAudio(false);

    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    await recorder.audioContext.close();

    const samples = mergeAudioBuffers(recorder.chunks);
    if (samples.length === 0) {
      setAudioRecordingError('No audio was captured.');
      return;
    }

    const wavBlob = encodeWav(samples, recorder.sampleRate);
    const content = await blobToDataUrl(wavBlob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    setUploadedFiles((prev) => [
      ...prev,
      {
        name: `voice-recording-${timestamp}.wav`,
        type: 'audio/wav',
        content,
      },
    ]);
    setAudioRecordingError('');
  };

  const startAudioRecording = async () => {
    if (needsReflection || isRecordingAudio) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioRecordingError('Audio recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioRecorderRef.current = {
        stream,
        audioContext,
        source,
        processor,
        chunks,
        sampleRate: audioContext.sampleRate,
      };
      setAudioRecordingError('');
      setIsRecordingAudio(true);
    } catch (error) {
      console.error('Failed to start audio recording:', error);
      setAudioRecordingError('Microphone access was blocked or unavailable.');
      setIsRecordingAudio(false);
    }
  };

  const toggleAudioRecording = () => {
    if (isRecordingAudio) {
      void stopAudioRecording();
      return;
    }

    void startAudioRecording();
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  const scrollToMessage = (messageId: string) => {
    window.setTimeout(() => {
      document.getElementById(`message-${messageId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  };

  const exportToSpreadsheet = () => {
    const escapeCsvCell = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const toFiniteNumber = (value: unknown) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : 0;
    };

    const getArrayLength = (value: unknown) => (Array.isArray(value) ? value.length : 0);

    const getTimestampMs = (value: Date | string | number | undefined) => {
      if (!value) return 0;
      if (value instanceof Date) return value.getTime();
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getRecordedDurationMinutes = (entry: ArchiveEntry) => {
      const record = entry as ArchiveEntry & Record<string, unknown>;
      const minuteValue =
        toFiniteNumber(record.timeSpentMinutes) ||
        toFiniteNumber(record.engagementMinutes) ||
        toFiniteNumber(record.durationMinutes);

      if (minuteValue > 0) {
        return Number(minuteValue.toFixed(2));
      }

      const millisecondValue =
        toFiniteNumber(record.timeSpentMs) ||
        toFiniteNumber(record.engagementDurationMs) ||
        toFiniteNumber(record.viewDurationMs) ||
        toFiniteNumber(record.responseViewedMs);

      return millisecondValue > 0 ? Number((millisecondValue / 60000).toFixed(2)) : 0;
    };

    const getActivityDurationMinutes = (entry: ArchiveEntry, index: number) => {
      const recordedDuration = getRecordedDurationMinutes(entry);
      if (recordedDuration > 0) return recordedDuration;

      const nextEntry = archiveEntries[index + 1];
      if (!nextEntry) return 0;

      const startTime = getTimestampMs(entry.timestamp);
      const endTime = getTimestampMs(nextEntry.timestamp);
      if (!startTime || !endTime || endTime <= startTime) return 0;

      return Number(((endTime - startTime) / 60000).toFixed(2));
    };

    const hasEditRecord = (entry: ArchiveEntry) => {
      const record = entry as ArchiveEntry & Record<string, unknown>;
      return getArrayLength(record.editEvents) > 0 ||
        getArrayLength(record.responseEditEvents) > 0 ||
        Boolean(record.responseEdited || record.aiResponseEdited || record.editedResponse)
        ? 1
        : 0;
    };

    const header = [
      'activity',
      'timespent on activity (minutes)',
      'web visits',
      'number of AI used',
      'copying (1 or 0)',
      'editing of ai response (1 or 0)',
    ];

    const rows = archiveEntries.map((entry, index) => [
      index + 1,
      getActivityDurationMinutes(entry, index),
      entry.webSourcesUsedCount || 0,
      entry.aiProvidersUsed.length,
      entry.copyEvents && entry.copyEvents.length > 0 ? 1 : 0,
      hasEditRecord(entry),
    ]);

    const csvContent = [header, ...rows]
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n');

    const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().split('T')[0];
    const link = document.createElement('a');
    link.href = url;
    link.download = `solvepistemic-archive-activity-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    const renderArchiveResponseText = (content: string) => {
      const segments: string[] = [];
      let lastIndex = 0;

      content.replace(archiveIncorrectPattern, (match, markedContent, offset) => {
        if (offset > lastIndex) {
          segments.push(renderRichText(stripArchiveIncorrectMarkers(content.slice(lastIndex, offset))));
        }

        segments.push(`<div class="archive-incorrect-text export-incorrect-text">${renderRichText(stripArchiveIncorrectMarkers(markedContent))}</div>`);
        lastIndex = offset + match.length;
        return match;
      });

      if (lastIndex < content.length) {
        segments.push(renderRichText(stripArchiveIncorrectMarkers(content.slice(lastIndex))));
      }

      return segments.length ? segments.join('') : renderRichText(stripArchiveIncorrectMarkers(content));
    };
    const archiveMarkup = archiveEntries.map((entry, index) => {
      const timestamp = escapeHtml(formatTimestamp(entry.timestamp));
      const querySource = removeAttachmentMetadataFromQuery(entry.userQuery) || 'No user query recorded';
      const queryText = renderRichText(querySource);
      const attachmentMarkup = getAttachmentExportMarkup(entry.attachments, renderRichText);
      const responseText = renderArchiveResponseText(entry.aiResponse || 'No AI response recorded');
      const copyLogMarkup = entry.copyEvents && entry.copyEvents.length > 0
        ? entry.copyEvents.map((event) => `
          <div class="copy-log-item">
            <div class="copy-log-meta">${escapeHtml(formatCopySource(event.source))} - ${escapeHtml(formatTimestamp(event.timestamp))}</div>
            <div class="copy-log-text">${renderPrintableLines(normalizePrintableText(event.text))}</div>
          </div>
        `).join('')
        : '<div class="empty-state">No copied AI response text recorded.</div>';
      const reflectionText = renderPrintableLines(normalizePrintableText(entry.reflection) || 'No reflection provided');
      const provider = escapeHtml(entry.aiProvider || 'Provider not recorded');
      const aiProvidersUsed = entry.aiProvidersUsed.length > 0
        ? escapeHtml(entry.aiProvidersUsed.join(', '))
        : 'None recorded';
      const webSourcesUsed = entry.webSourcesUsed ? 'Yes' : 'No';
      const webSourceCount = entry.webSourcesUsedCount || 0;
      return `
        <section class="entry">
          <div class="entry-header">
            <h2>Activity ${index + 1}</h2>
            <div class="timestamp">${timestamp}</div>
          </div>
          <div class="provider-row">
            <div class="provider">${provider}</div>
          </div>
          <div class="field">
            <div class="label">Query Source Usage</div>
            <div class="value">
              AI provider count: ${entry.aiProvidersUsed.length}<br />
              AI providers used: ${aiProvidersUsed}<br />
              External web source count: ${webSourceCount}<br />
              External web sources used: ${webSourcesUsed}
            </div>
          </div>
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
            <div class="label">Copy Log</div>
            <div class="copy-log-list">${copyLogMarkup}</div>
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
            .page-summary {
              text-align: center;
              margin: -14px 0 28px;
              color: #111827;
              font-family: Arial, sans-serif;
              font-size: 14px;
              font-weight: 700;
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
            }
            .provider-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
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
            .archive-incorrect-text {
              border: 1px solid #f87171;
              border-left: 4px solid #dc2626;
              border-radius: 8px;
              background: #fee2e2;
              color: #7f1d1d;
              padding: 6px 8px;
              margin: 6px 0;
            }
            .archive-incorrect-text,
            .archive-incorrect-text * {
              color: #7f1d1d !important;
            }
            .archive-incorrect-text :first-child {
              margin-top: 0;
            }
            .archive-incorrect-text :last-child {
              margin-bottom: 0;
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
            .copy-log-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .copy-log-item {
              border-radius: 10px;
              border: 1px solid #dbe4f0;
              background: #f8fafc;
              padding: 10px 12px;
            }
            .copy-log-meta {
              font-family: Arial, sans-serif;
              font-size: 11px;
              font-weight: 700;
              color: #475569;
              margin-bottom: 6px;
            }
            .copy-log-text {
              font-size: 12px;
              line-height: 1.6;
              color: #1f2937;
              word-break: break-word;
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
            .attachment-audio {
              width: 100%;
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
          <div class="page-summary">Total Prompts: ${escapeHtml(formatPromptCount(archiveQueryCount))}</div>
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
        clearLocalArchiveState(userId);
        console.log('✅ All messages cleared successfully');
      } else {
        const errorData = await response.json().catch(() => null);
        console.error('Failed to clear messages remotely:', errorData?.error || response.statusText);
        clearLocalArchiveState(userId);
        alert('Messages were cleared on this device, but the remote archive could not be cleared right now.');
      }
    } catch (error) {
      console.error('Error clearing messages remotely:', error);
      clearLocalArchiveState(userId);
      alert('Messages were cleared on this device, but the remote archive could not be cleared right now.');
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

  const runImageGeneration = async (promptText: string, displayContent?: string) => {
    const prompt = promptText.trim();

    if (!prompt) {
      alert('Please describe the image you want to generate in the chat prompt.');
      return;
    }

    setIsGeneratingImage(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: displayContent || prompt,
      timestamp: new Date(),
      aiProvider: IMAGE_PROVIDER_LABEL,
    };

    setMessages((prev) => [...prev, userMessage]);
    void saveMessage(userMessage);
    setInput('');
    setUploadedFiles([]);
    setImagePrompt('');
    setShowImageDialog(false);

    try {
      console.log('Sending image generation request:', { prompt });
      const response = await fetch(`${API_BASE_URL}/generate-image`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ prompt }),
      });

      console.log('Image generation response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error from image generation server:', errorData);
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const data = await response.json();
      console.log('Image generated successfully:', data);
      const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
      const revisedPrompt = data.revisedPrompt || prompt;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Generated Image\n\n**Prompt**: ${revisedPrompt}`,
        timestamp: new Date(),
        aiProvider: IMAGE_PROVIDER_LABEL,
      };
      assistantMessage.attachments = imageUrl
        ? [{
            name: `${revisedPrompt.toString().trim().slice(0, 60) || 'generated-image'}.png`,
            type: 'image/png',
            content: imageUrl,
            preview: imageUrl,
            generated: true,
          }]
        : undefined;

      setMessages((prev) => [...prev, assistantMessage]);
      void saveMessage(assistantMessage);
      scrollToMessage(assistantMessage.id);
    } catch (error) {
      console.error('Error generating image:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `**Image Generation Error**: Sorry, there was an error generating the image.\n\n**Details**: ${errorMessage}`,
        timestamp: new Date(),
        aiProvider: IMAGE_PROVIDER_LABEL,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      void saveMessage(assistantMessage);
      scrollToMessage(assistantMessage.id);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerateImage = async () => {
    await runImageGeneration(imagePrompt, `**Generate Image**: ${imagePrompt.trim()}`);
  };

  const runInternetImageSearch = async (queryText: string, displayContent?: string) => {
    const query = queryText.trim();

    if (!query) {
      alert('Please describe the image you want to find online in the chat prompt.');
      return;
    }

    setIsSearchingImages(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: displayContent || query,
      timestamp: new Date(),
      aiProvider: IMAGE_SEARCH_PROVIDER_LABEL,
    };

    setMessages((prev) => [...prev, userMessage]);
    void saveMessage(userMessage);
    setInput('');
    setUploadedFiles([]);
    setImageSearchQuery('');
    setShowImageSearchDialog(false);

    const pendingMessage: Message = {
      id: `image-search-${Date.now() + 1}`,
      role: 'assistant',
      content: `## Internet image results\n\nSearching the internet for images of: **${escapeMarkdownText(query)}**...`,
      timestamp: new Date(),
      aiProvider: IMAGE_SEARCH_PROVIDER_LABEL,
    };

    setMessages((prev) => [...prev, pendingMessage]);
    scrollToMessage(pendingMessage.id);

    try {
      const response = await fetch(`${API_BASE_URL}/image-search`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ query }),
      });
      const responseText = await response.text();
      let data: ImageSearchData = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.error || responseText.slice(0, 240) || 'Failed to pull images from the internet');
      }

      const images = Array.isArray(data.images) ? data.images.filter((image) => image?.imageUrl) : [];
      const attachments = images.map((image, index) => ({
        name: image.title || `internet-image-${index + 1}`,
        type: 'image/jpeg',
        content: image.imageUrl,
        preview: image.thumbnailUrl || image.imageUrl,
        generated: false,
      }));

      const updatedMessage: Message = {
        ...pendingMessage,
        content: formatImageSearchResults(data, query),
        attachments: attachments.length ? attachments : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) =>
        prev.map((message) => (message.id === pendingMessage.id ? updatedMessage : message))
      );
      scrollToMessage(pendingMessage.id);
      void saveMessage(updatedMessage);
    } catch (error) {
      const updatedMessage: Message = {
        ...pendingMessage,
        content: [
          '## Internet image results',
          '',
          'Sorry, I could not pull images from the internet right now.',
          '',
          `**Details**: ${error instanceof Error ? error.message : 'Failed to pull images from the internet'}`,
        ].join('\n'),
        timestamp: new Date(),
      };

      setMessages((prev) =>
        prev.map((message) => (message.id === pendingMessage.id ? updatedMessage : message))
      );
      scrollToMessage(pendingMessage.id);
      void saveMessage(updatedMessage);
    } finally {
      setIsSearchingImages(false);
    }
  };

  const handleSearchInternetImages = async () => {
    await runInternetImageSearch(imageSearchQuery, `**Pull Images from Internet**: ${imageSearchQuery.trim()}`);
  };
  const needsReflection = false;
  const canSendMessage = !isRecordingAudio && (input.trim() || uploadedFiles.length > 0);
  const archiveEntries = buildArchiveEntries(archiveMessages);
  const archiveQueryCount = archiveEntries.length;
  const prepareAiComparisonPrompt = (
    sourcePrompt: string,
    responseContent: string,
    sourceProvider: string | undefined,
    sourceMessageId: string
  ) => {
    const nextProvider = getAlternateChatProvider(sourceProvider);
    const requestPrompt = [
      'Answer the original query as a second AI reviewer.',
      'Give a complete, normal response to the query first. Then briefly mention any important differences from the previous AI response.',
      '',
      'Original query:',
      sourcePrompt,
      '',
      'Previous AI response for context:',
      responseContent,
    ].join('\n');

    selectChatProvider(nextProvider);
    void handleSend({
      displayInput: sourcePrompt || 'Ask another AI to review the previous response',
      requestInput: requestPrompt,
      provider: nextProvider,
      skipUserMessage: true,
      insertAfterMessageId: sourceMessageId,
      comparisonResponse: true,
    });
  };

  const insertLocalMessageAfter = (newMessage: Message, sourceMessageId: string) => {
    setMessages((prev) => {
      const sourceIndex = prev.findIndex((message) => message.id === sourceMessageId);
      if (sourceIndex === -1) return [...prev, newMessage];
      return [
        ...prev.slice(0, sourceIndex + 1),
        newMessage,
        ...prev.slice(sourceIndex + 1),
      ];
    });
  };

  const handleViewExternalSources = async (
    sourcePrompt: string,
    _responseContent: string,
    sourceMessageId: string
  ) => {
    const query = sourcePrompt.trim();
    if (!query) return;

    const pendingMessage: Message = {
      id: `web-search-${Date.now()}`,
      role: 'assistant',
      content: `## External web sources\n\nSearching the web for: **${escapeMarkdownText(query)}**...`,
      timestamp: new Date(),
      aiProvider: WEB_SOURCE_PROVIDER_LABEL,
    };

    insertLocalMessageAfter(pendingMessage, sourceMessageId);
    scrollToMessage(pendingMessage.id);

    try {
      const response = await fetch(`${CHAT_API_BASE_URL}/web-search`, {
        method: 'POST',
        headers: buildApiHeaders(true),
        body: JSON.stringify({ query }),
      });
      const responseText = await response.text();
      let data: WebSearchData = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.error || responseText.slice(0, 240) || 'Failed to search web sources');
      }

      const updatedMessage: Message = {
        ...pendingMessage,
        content: formatWebSearchResults(data, query),
        timestamp: new Date(),
      };

      setMessages((prev) =>
        prev.map((message) => (message.id === pendingMessage.id ? updatedMessage : message))
      );
      scrollToMessage(pendingMessage.id);
      void saveMessage(updatedMessage);
    } catch (error) {
      const updatedMessage: Message = {
        ...pendingMessage,
        content: [
          '## External web sources',
          '',
          'Sorry, I could not search external web sources right now.',
          '',
          `**Details**: ${error instanceof Error ? error.message : 'Failed to search web sources'}`,
        ].join('\n'),
        timestamp: new Date(),
      };

      setMessages((prev) =>
        prev.map((message) => (message.id === pendingMessage.id ? updatedMessage : message))
      );
      scrollToMessage(pendingMessage.id);
      void saveMessage(updatedMessage);
    }
  };

  return (
    <div className="h-screen bg-slate-50 flex">
      <div className="w-full h-full bg-white flex flex-col">{/* Header */}
        <div className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white flex-shrink-0">
          <div className="flex items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <Brain className="size-5 flex-shrink-0" />
              <div>
                <h1 className="text-sm font-semibold leading-tight">Solvepistemic</h1>
                <p className="text-[11px] leading-tight text-white/80">Welcome, {userName}! Backend: {API_BACKEND_LABEL}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowClearWorkspaceDialog(true)}
                className="size-8 rounded-lg bg-white/20 hover:bg-white/30 transition flex items-center justify-center"
                title="Clear Workspace (preserves archive)"
              >
                <Eraser className="size-4" />
              </button>
              <button
                onClick={() => setShowArchive(!showArchive)}
                className="size-8 rounded-lg bg-white/20 hover:bg-white/30 transition flex items-center justify-center"
                title="Archive"
              >
                <Archive className="size-4" />
              </button>
              <button
                onClick={handleSignOut}
                className="size-8 rounded-lg bg-white/20 hover:bg-white/30 transition flex items-center justify-center"
                title="Sign Out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex overflow-hidden min-h-0 bg-slate-50">
          
          {/* Chat */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="flex-1 overflow-y-auto p-2 sm:p-3 min-h-0">
              <div ref={scrollRef} className="space-y-2">
                {messages.map((message, index) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    sourcePrompt={message.role === 'assistant' ? findPreviousUserPrompt(messages, index) : ''}
                    onFeedbackChange={updateFeedback}
                    onCopyLog={recordCopyEvent}
                    onCompareWithAnotherAI={prepareAiComparisonPrompt}
                    onViewExternalSources={handleViewExternalSources}
                    normalizeContent={normalizeRenderedContent}
                  />
                ))}
                
                {isTyping && (
                  <div className="flex gap-2">
                    <div className="size-7 rounded-full bg-purple-600 flex items-center justify-center">
                      <Sparkles className="size-4 text-white" />
                    </div>
                    <div className="p-2 rounded-lg bg-gray-100">
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
            <div className="border-t bg-white px-2 py-1.5">
              {/* Reflection Reminder */}
              {needsReflection && (
                <div className="mb-1.5 flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-2.5 py-1.5">
                  <div className="size-5 rounded-full bg-yellow-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <p className="text-xs text-yellow-900">
                    <span className="font-semibold">Reflection Required:</span> answer both reflection questions before continuing.
                  </p>
                </div>
              )}
              
              {/* File Previews */}
              {uploadedFiles.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
                      {file.type.startsWith('audio/') ? (
                        <AudioLines className="size-4 text-blue-600" />
                      ) : file.type.startsWith('image/') ? (
                        <ImageIcon className="size-4 text-blue-600" />
                      ) : (
                        <FileIcon className="size-4 text-blue-600" />
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

              <div className="flex gap-1.5">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="relative">
                    <Button
                      type="button"
                      onClick={toggleVoiceInput}
                      size="icon"
                      variant={isListening ? 'default' : 'outline'}
                      className={`absolute right-10 top-1/2 z-10 size-8 -translate-y-1/2 rounded-lg ${
                        isListening
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700'
                      }`}
                      disabled={needsReflection || !speechSupported}
                      title={speechSupported ? (isListening ? 'Stop voice input' : 'Start voice input') : 'Voice input is not supported in this browser'}
                    >
                      {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                    </Button>
                    <Button
                      onClick={() => handleSend()}
                      size="icon"
                      className="absolute right-1.5 top-1/2 z-10 size-8 -translate-y-1/2 rounded-lg"
                      disabled={!canSendMessage}
                    >
                      <Send className="size-4" />
                    </Button>
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder={needsReflection ? "Please complete the reflection above to continue..." : "Describe your problem or ask a question..."}
                      className="flex-1 min-h-[40px] pr-20 text-sm"
                      disabled={needsReflection}
                    />
                  </div>
                  {(isRecordingAudio || audioRecordingError || isListening || speechError) && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-gray-500 min-w-0 flex-1 truncate">
                        {isRecordingAudio
                          ? 'Recording audio... tap Stop Recording to attach it.'
                          : audioRecordingError || (isListening
                            ? 'Listening... speak clearly, then tap the mic to stop.'
                            : speechError)}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    accept="audio/*,image/*,.pdf,.docx,.txt,.md,.csv,.py,.js,.java,.cpp,.c,.html,.css,.json"
                    className="hidden"
                    disabled={needsReflection || isRecordingAudio}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className="size-7 rounded-lg border-gray-300 bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700"
                    disabled={needsReflection || isRecordingAudio}
                    title="Attach files"
                  >
                    <Paperclip className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant={isRecordingAudio ? 'default' : 'outline'}
                    size="icon"
                    onClick={toggleAudioRecording}
                    className={`size-7 rounded-lg ${
                      isRecordingAudio
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100'
                    }`}
                    disabled={needsReflection}
                    title={isRecordingAudio ? 'Stop recording and attach audio' : 'Record audio to attach to the prompt'}
                  >
                    {isRecordingAudio ? <Square className="size-3.5" /> : <AudioLines className="size-3.5" />}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setNormalizeRenderedContent(prev => !prev)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition flex items-center gap-1.5 ${
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
                      onClick={() => selectChatProvider(providerOption.id)}
                      disabled={isTyping}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        selectedProvider === providerOption.id
                          ? 'border-purple-600 bg-purple-600 text-white shadow-sm'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-purple-300 hover:text-purple-700'
                      } ${isTyping ? 'cursor-not-allowed opacity-70' : ''}`}
                    >
                      {providerOption.label}
                    </button>
                  ))}
                </div>
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Button
                    onClick={scrollToBottom}
                    size="icon"
                    className="size-9 bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"
                    title="Jump to Latest Message"
                    disabled={messages.length === 0}
                  >
                    <ArrowDown className="size-4" />
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
                  <button onClick={exportToSpreadsheet} className="h-8 px-2 rounded hover:bg-white/20 flex items-center justify-center gap-1 text-[11px] font-semibold" title="Export activity spreadsheet">
                    <FileDown className="size-4" />
                    <span>CSV</span>
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
                  <div
                    key={entry.id}
                    className="p-3 mb-3 rounded-lg border bg-gray-50 border-gray-200"
                  >
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">
                          Activity {index + 1}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800">
                            AI: {entry.aiProvidersUsed.length}
                          </span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                            Web: {entry.webSourcesUsedCount || 0}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">{formatTimestamp(entry.timestamp)}</div>
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-purple-700">
                        {entry.aiProvider || 'Provider not recorded'}
                      </div>
                    </div>
                    <div className="mb-3 grid gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-2 text-xs text-emerald-950">
                      <div>
                        <div className="font-semibold">AI provider count</div>
                        <div>
                          {entry.aiProvidersUsed.length} {entry.aiProvidersUsed.length === 1 ? 'provider' : 'providers'}
                          {entry.aiProvidersUsed.length > 0 ? `: ${entry.aiProvidersUsed.join(', ')}` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold">External web source count</div>
                        <div>
                          {entry.webSourcesUsedCount || 0} {(entry.webSourcesUsedCount || 0) === 1 ? 'check' : 'checks'}
                        </div>
                      </div>
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
                      <div className="text-sm rounded-md border p-2 bg-white border-gray-200">
                        {entry.aiResponse ? <ArchiveResponseRenderer content={entry.aiResponse} normalizeContent={normalizeRenderedContent} /> : <span className="text-gray-500">No AI response recorded</span>}
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1 text-xs font-semibold text-gray-700">Copy Log</div>
                      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                        {entry.copyEvents && entry.copyEvents.length > 0 ? (
                          entry.copyEvents.map((event, copyIndex) => (
                            <div key={entry.id + '-copy-' + copyIndex} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                              <div className="mb-1 font-semibold text-slate-900">
                                {formatCopySource(event.source)} - {formatTimestamp(event.timestamp)}
                              </div>
                              <div className="whitespace-pre-wrap break-words">{event.text}</div>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-slate-500">No copied AI response text recorded.</div>
                        )}
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
              Generate Image
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

      {/* Internet Image Search Dialog */}
      <Dialog open={showImageSearchDialog} onOpenChange={setShowImageSearchDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="size-5 text-teal-600" />
              Pull Images from Internet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-900">
                What image should the app find online?
              </label>
              <p className="text-xs text-gray-600">
                Pull existing images from internet sources and add returned image results to the chat. This is separate from generating a new image.
              </p>
              <Textarea
                value={imageSearchQuery}
                onChange={(e) => setImageSearchQuery(e.target.value)}
                placeholder="e.g., oil rig engineer working onsite"
                className="min-h-[96px]"
                disabled={isSearchingImages}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowImageSearchDialog(false);
                  setImageSearchQuery('');
                }}
                disabled={isSearchingImages}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSearchInternetImages}
                disabled={!imageSearchQuery.trim() || isSearchingImages}
                className="bg-teal-600 hover:bg-teal-700"
              >
                {isSearchingImages ? (
                  <>
                    <span className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="size-4 mr-2" />
                    Pull Images
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






