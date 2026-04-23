import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js";
import * as kv from "./kv_store.tsx";
const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Supabase function routes are relative to the function name in the URL.
// Example external path: /functions/v1/make-server-09672449/health
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Test Supabase connection
app.get("/debug/test-supabase", async (c) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return c.json({ 
        error: "Missing credentials",
        url_present: !!supabaseUrl,
        key_present: !!supabaseServiceKey
      }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to list users to test connection
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      return c.json({
        success: false,
        error: error.message,
        code: error.code,
        status: error.status
      }, 401);
    }

    return c.json({
      success: true,
      message: "Supabase connection successful",
      userCount: data.users.length
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// Save a message to the activity log (user-specific)
app.post("/messages/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    const { id, role, content, timestamp, aiProvider, feedback, attachments, isIncorrect } = await c.req.json();
    
    if (!userId || !id || !role || !content || !timestamp) {
      return c.json({ error: "Missing required fields: userId, id, role, content, timestamp" }, 400);
    }

    const message = { 
      id, 
      role, 
      content, 
      timestamp, 
      aiProvider: aiProvider || undefined,
      feedback: feedback || undefined, 
      attachments: attachments || undefined,
      isIncorrect: isIncorrect ?? false  // Use ?? instead of || to preserve false values
    };
    await kv.set(`user:${userId}:message:${id}`, message);
    
    console.log(`Message saved for user ${userId}: ${id}${isIncorrect ? ' (INCORRECT)' : ''}`);
    return c.json({ success: true, message });
  } catch (error) {
    console.error(`Error saving message to database: ${error}`);
    return c.json({ error: `Failed to save message: ${error}` }, 500);
  }
});

// Get all messages for a specific user
app.get("/messages/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    
    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }
    
    const messages = await kv.getByPrefix(`user:${userId}:message:`);
    
    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
    
    console.log(`Retrieved ${sortedMessages.length} messages for user ${userId}`);
    return c.json({ messages: sortedMessages });
  } catch (error) {
    console.error(`Error retrieving messages from database: ${error}`);
    return c.json({ error: `Failed to retrieve messages: ${error}` }, 500);
  }
});

// Delete all messages for a specific user
app.delete("/messages/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");
    
    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }
    
    // Get all message keys for this user
    const messages = await kv.getByPrefix(`user:${userId}:message:`);
    const messageKeys = messages.map(msg => `user:${userId}:message:${msg.id}`);
    
    // Delete all messages
    if (messageKeys.length > 0) {
      await kv.mdel(messageKeys);
      console.log(`Deleted ${messageKeys.length} messages for user ${userId}`);
    }
    
    return c.json({ success: true, deletedCount: messageKeys.length });
  } catch (error) {
    console.error(`Error deleting messages from database: ${error}`);
    return c.json({ error: `Failed to delete messages: ${error}` }, 500);
  }
});

// Update feedback for a specific message (user-specific)
app.put("/messages/:userId/:messageId/feedback", async (c) => {
  try {
    const userId = c.req.param("userId");
    const messageId = c.req.param("messageId");
    const { feedback } = await c.req.json();
    
    if (!userId || !messageId) {
      return c.json({ error: "User ID and Message ID are required" }, 400);
    }
    
    // Get the existing message
    const existingMessage = await kv.get(`user:${userId}:message:${messageId}`);
    
    if (!existingMessage) {
      return c.json({ error: "Message not found" }, 404);
    }
    
    // Update the message with feedback
    const updatedMessage = { ...existingMessage, feedback };
    await kv.set(`user:${userId}:message:${messageId}`, updatedMessage);
    
    console.log(`Feedback updated for user ${userId}, message: ${messageId}`);
    return c.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error(`Error updating feedback: ${error}`);
    return c.json({ error: `Failed to update feedback: ${error}` }, 500);
  }
});

const SYSTEM_PROMPT = `You are a helpful AI assistant for problem-solving support. Provide clear, structured responses using markdown formatting with professional mathematical equation rendering.

IMPORTANT: You have access to DALL-E 3 for image generation. When a student asks you to generate, create, or draw an image, diagram, or illustration, tell them to use the Generate Image button next to Attach Files instead of asking in chat.

When you detect image-generation requests, respond with:
"I can help you generate images using DALL-E 3. Please click the Generate Image button next to Attach Files below, describe what you want to see, and I will create it for you."

CRITICAL RULE: parentheses, brackets, braces, equals signs, and punctuation that are part of a mathematical expression must stay inside the LaTeX delimiters.

Use these formatting rules:
1. Use LaTeX for all mathematical expressions.
2. Use headings, bullet points, numbered lists, and code blocks when helpful.
3. Keep mathematical notation clear and publication-quality.
4. For inline math use $...$ and for display equations use $$...$$.`;

const parseDataUrl = (value: string) => {
  const match = value.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mediaType: match[1],
    data: match[2],
  };
};

const buildGeminiUserParts = (message: string, files: any[]) => {
  const parts: any[] = [{ text: message }];

  for (const file of files) {
    if (file.type?.startsWith("image/")) {
      const parsed = parseDataUrl(file.content);
      if (parsed) {
        parts.push({
          inline_data: {
            mime_type: parsed.mediaType,
            data: parsed.data,
          },
        });
      }
    } else if (file.name) {
      parts[0].text += `\n\n[File attached: ${file.name}]`;
    }
  }

  return parts;
};

const buildAnthropicUserContent = (message: string, files: any[]) => {
  const contentParts: any[] = [{ type: "text", text: message }];

  for (const file of files) {
    if (file.type?.startsWith("image/")) {
      const parsed = parseDataUrl(file.content);
      if (parsed) {
        contentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mediaType,
            data: parsed.data,
          },
        });
      }
    } else if (file.name) {
      contentParts[0].text += `\n\n[File attached: ${file.name}]`;
    }
  }

  return contentParts;
};

// Chat endpoint
app.post("/chat", async (c) => {
  try {
    const { message, conversationHistory = [], files = [], provider = "openai" } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    if (provider === "google") {
      const googleApiKey = Deno.env.get("GOOGLE_API_KEY");
      if (!googleApiKey) {
        return c.json({ error: "Google API key not configured" }, 500);
      }

      const contents = conversationHistory.map((msg: any) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      contents.push({
        role: "user",
        parts: buildGeminiUserParts(message, files),
      });

      const googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${googleApiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
          },
        }),
      });

      if (!googleResponse.ok) {
        const errorData = await googleResponse.json();
        console.error("Google API error:", errorData);
        return c.json({ error: `Google API error: ${errorData.error?.message || "Unknown error"}` }, googleResponse.status);
      }

      const googleData = await googleResponse.json();
      const assistantMessage =
        googleData.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("").trim() ||
        "No response generated.";

      return c.json({ response: assistantMessage, providerUsed: "google" });
    }

    if (provider === "claude") {
      const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicApiKey) {
        return c.json({ error: "Anthropic API key not configured" }, 500);
      }

      const anthropicMessages = conversationHistory.map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      }));

      anthropicMessages.push({
        role: "user",
        content: buildAnthropicUserContent(message, files),
      });

      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-latest",
          max_tokens: 2048,
          temperature: 0.7,
          system: SYSTEM_PROMPT,
          messages: anthropicMessages,
        }),
      });

      if (!anthropicResponse.ok) {
        const errorData = await anthropicResponse.json();
        console.error("Anthropic API error:", errorData);
        return c.json({ error: `Anthropic API error: ${errorData.error?.message || "Unknown error"}` }, anthropicResponse.status);
      }

      const anthropicData = await anthropicResponse.json();
      const assistantMessage =
        anthropicData.content?.map((item: any) => item.text || "").join("").trim() ||
        "No response generated.";

      return c.json({ response: assistantMessage, providerUsed: "claude" });
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }

    // Build message array for OpenAI
    const messages: any[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant for problem-solving support. Provide clear, structured responses using markdown formatting with professional mathematical equation rendering.

**IMPORTANT**: You have access to DALL-E 3 for image generation! When a student asks you to generate, create, or draw an image/diagram/illustration, inform them to use the "Generate Image" button (purple button with wand icon) located next to the "Attach Files" button. They should NOT ask you in chat - they need to click that button and describe what they want.

Examples of requests that need the Generate Image button:
- "Can you draw a diagram of..."
- "Generate an image of..."
- "Create an illustration showing..."
- "I need a picture of..."
- "Show me a visual of..."

When you detect these requests, respond with:
"🎨 I can help you generate images using DALL-E 3! Please click the **Generate Image** button (purple button with wand icon ✨) next to the 'Attach Files' button below. Describe what you want to see, and I'll create it for you!"

⚠️ CRITICAL RULE #1 - MATHEMATICAL DELIMITER PLACEMENT ⚠️

ALL parentheses, brackets, braces, equals signs, and punctuation that are PART OF the mathematical expression MUST be placed INSIDE the $ delimiters. This is NON-NEGOTIABLE.

CORRECT EXAMPLES:
- "when $(a \\neq 0)$, we can divide..."  ✅
- "The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$."  ✅
- "if $f(x) = 0$, then..."  ✅
- "The set $\\{1, 2, 3\\}$ contains..."  ✅
- "for $(x > 0)$ and $(y < 10)$"  ✅
- "The interval $[0, 1]$ is closed."  ✅
- "where $g(x, y) = xy + 1$"  ✅

WRONG EXAMPLES (NEVER DO THIS):
- "when ( $a \\neq 0$ ), we can divide..."  ❌
- "The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ ."  ❌
- "if $f(x)$ = 0, then..."  ❌
- "The set { $1, 2, 3$ } contains..."  ❌
- "for ( $x > 0$ ) and ( $y < 10$ )"  ❌
- "The interval [ $0, 1$ ] is closed."  ❌
- "where $g(x, y)$ = xy + 1"  ❌

FORMATTING REQUIREMENTS:

1. **Mathematical Equations** - Use LaTeX with proper delimiters:
   
   - **Inline math**: Use $...$ for equations within text
     Example: "The derivative $\\frac{dy}{dx} = 2x$ shows that..."
   
   - **Display/Block math**: Use $$...$$ on separate lines for centered equations
     Example:
     $$
     \\int_{0}^{\\infty} e^{-x} dx = 1
     $$
   
   - **NEVER write mathematical expressions in plain text**. Always use LaTeX delimiters.

2. **Common LaTeX Patterns**:
   - Fractions: $\\frac{a}{b}$
   - Square roots: $\\sqrt{x}$ or $\\sqrt[n]{x}$
   - Powers and subscripts: $x^2$, $x_i$, $x^{2n+1}$, $a_{i,j}$
   - Greek letters: $\\alpha$, $\\beta$, $\\gamma$, $\\Delta$, $\\theta$, $\\lambda$, $\\pi$, $\\sigma$
   - Summations: $\\sum_{i=1}^{n} x_i$
   - Products: $\\prod_{i=1}^{n} x_i$
   - Integrals: $\\int_{a}^{b} f(x) dx$ or $\\oint_C f(z) dz$
   - Limits: $\\lim_{x \\to \\infty} f(x) = L$
   - Partial derivatives: $\\frac{\\partial f}{\\partial x}$
   - Vectors: $\\vec{v}$ or $\\boldsymbol{F}$
   - Matrices: 
     $$
     \\begin{bmatrix}
     a & b \\\\
     c & d
     \\end{bmatrix}
     $$
   - Systems of equations:
     $$
     \\begin{cases}
     x + y = 5 \\\\
     2x - y = 1
     \\end{cases}
     $$
   - Conditions with parentheses: $(a \\neq 0)$, $(x > 0)$, $(n \\geq 1)$
   - Sets and intervals: $\\{1, 2, 3, \\ldots, n\\}$, $(a, b)$, $[0, 1]$
   - Function notation: $f(x) = x^2 + 1$, $g(x, y) = \\sin(x) \\cos(y)$
   - Trigonometry: $\\sin(\\theta)$, $\\cos(x)$, $\\tan(\\alpha)$, $\\sec(x)$
   - Logarithms: $\\log(x)$, $\\ln(x)$, $\\log_{2}(8) = 3$

3. **Content Structure**:
   - Use headings (##, ###) to organize information
   - Use bullet points and numbered lists appropriately
   - Use code blocks with syntax highlighting for programming code
   - Use blockquotes for important notes or definitions

4. **Quality Standards**:
   - All mathematical expressions MUST be properly formatted with LaTeX
   - Parentheses, brackets, braces, and ALL punctuation that's part of the math goes INSIDE the $...$ delimiters
   - Display equations should be on their own lines for maximum clarity
   - Complex multi-step solutions should show each step clearly

Remember: This is a professional educational environment. Mathematical notation must be publication-quality with perfect delimiter placement. The equation $(a \\neq 0)$ should NEVER appear as ( $a \\neq 0$ ).`
      }
    ];

    // Add conversation history
    conversationHistory.forEach((msg: any) => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Process files for Vision API
    if (files.length > 0) {
      const contentParts: any[] = [{ type: "text", text: message }];
      
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          // Image file - add to vision content
          contentParts.push({
            type: "image_url",
            image_url: {
              url: file.content
            }
          });
        } else if (file.type === 'application/pdf' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          // For PDF/Word, we would need to extract text first
          // For now, just mention the file in the message
          contentParts[0].text += `\n\n[File attached: ${file.name}]`;
        }
      }
      
      messages.push({
        role: "user",
        content: contentParts
      });
    } else {
      messages.push({
        role: "user",
        content: message
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: messages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("OpenAI API error:", errorData);
      return c.json({ error: `OpenAI API error: ${errorData.error?.message || 'Unknown error'}` }, response.status);
    }

    const data = await response.json();
    const assistantMessage = data.choices[0]?.message?.content || "No response generated.";

    return c.json({ response: assistantMessage, providerUsed: "openai" });
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    return c.json({ error: `Failed to process chat request: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});

// DALL-E Image Generation endpoint
app.post("/generate-image", async (c) => {
  try {
    const { prompt, size = "1024x1024", quality = "standard" } = await c.req.json();

    if (!prompt) {
      return c.json({ error: "Image prompt is required" }, 400);
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }

    console.log(`🎨 Generating image with DALL-E 3: "${prompt}"`);

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("DALL-E API error:", errorData);
      return c.json({ error: `DALL-E API error: ${errorData.error?.message || 'Unknown error'}` }, response.status);
    }

    const data = await response.json();
    const imageUrl = data.data[0]?.url;
    const revisedPrompt = data.data[0]?.revised_prompt;

    if (!imageUrl) {
      return c.json({ error: "No image URL returned from DALL-E" }, 500);
    }

    console.log(`✅ Image generated successfully`);
    return c.json({ 
      imageUrl,
      revisedPrompt: revisedPrompt || prompt
    });
  } catch (error) {
    console.error("Error in image generation endpoint:", error);
    return c.json({ error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});

// Sign Up endpoint
app.post("/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    
    if (!email || !password) {
      console.error('Sign up validation failed: Missing email or password');
      return c.json({ error: "Email and password are required" }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Sign up error: Missing Supabase credentials');
      return c.json({ error: "Server configuration error: Missing Supabase credentials" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Attempting to create user: ${email}`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      user_metadata: { name: name || email.split('@')[0] },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true
    });

    if (error) {
      console.error(`Sign up error from Supabase: ${error.message}`, error);
      return c.json({ error: error.message }, 400);
    }

    if (!data.user) {
      console.error('Sign up error: User created but no user data returned');
      return c.json({ error: "Failed to create user account" }, 500);
    }

    console.log(`User created successfully: ${email}, attempting auto sign-in`);

    // Sign in the user immediately after creation to get access token
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error(`Auto sign-in error after signup: ${signInError.message}`, signInError);
      return c.json({ error: `Account created but sign-in failed: ${signInError.message}` }, 400);
    }

    if (!signInData.session?.access_token) {
      console.error('Auto sign-in error: No access token received');
      return c.json({ error: "Account created but failed to get access token" }, 500);
    }

    console.log(`User created and signed in successfully: ${email}`);
    return c.json({ 
      success: true,
      user: data.user,
      access_token: signInData.session.access_token 
    });
  } catch (error) {
    console.error(`Error in signup endpoint: ${error}`, error);
    return c.json({ error: `Failed to create account: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});

Deno.serve(app.fetch);
