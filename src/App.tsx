/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Sparkles, ChevronRight, Info, Star } from 'lucide-react';
import catalogData from './data/furniture_catalog.json';

// --- Types ---

type Stage = 'broad' | 'contextual' | 'preferences' | 'specific';

interface Product {
  product_id: string;
  name: string;
  category: string;
  price: number;
  image_url: string;
  thumbnail_url: string;
  aesthetic_tags: string[];
  dimensions: any;
  key_features: string[];
  user_friendly_description: string;
  reviews_summary: string;
  rating: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  quickReplies?: string[];
  products?: any[]; // Products recommended in this specific turn
}

interface ConversationContext {
  intent: string | null;
  room: string | null;
  space: string | null;
  budget: {
    min: number | null;
    max: number | null;
  };
  aesthetic: string[];
  product_type: string | null;
}

interface ConversationState {
  stage: Stage;
  context: ConversationContext;
  products_shown: boolean;
  selected_products: string[];
  history: Message[];
}

// --- Constants ---

const COLORS = {
  bg: '#FFFFFF',
  text: '#1A1A1A',
  userBubble: '#F0F0F0',
  assistantBubble: '#E8F4F8',
  accentPrimary: '#2D5B7B',
  accentSecondary: '#D4A574',
  border: '#E0E0E0',
  buttonPrimary: '#2D5B7B',
};

const SYSTEM_INSTRUCTION = `You are Lumi, a furniture discovery assistant. Your job is to refine fuzzy goals through efficient conversation.

CRITICAL RULE: NEVER ask the same question twice. Track what you know.

═══════════════════════════════════════════════════════════
CONVERSATION STAGES
═══════════════════════════════════════════════════════════
1. BROAD: Understand INTENT.
2. CONTEXTUAL: Understand SPACE and USAGE.
3. PREFERENCES: Understand BUDGET and AESTHETIC.
4. SPECIFIC: Show products and help decide.

═══════════════════════════════════════════════════════════
QUICK REPLY OPTIONS (Strict Usage)
═══════════════════════════════════════════════════════════
ONLY provide quick replies if:
- The user explicitly says "not sure", "I don't know", or seems stuck.
- You are asking for a specific choice between 2-4 distinct options (e.g., budget ranges).
- You are clarifying a fuzzy intent.

Do NOT provide suggestions for open-ended conversation or when the user is already providing clear details.

Format:
[Option 1 | Option 2 | Option 3]

═══════════════════════════════════════════════════════════
FORMATTING RULES:
═══════════════════════════════════════════════════════════
- Natural paragraphs only.
- Plain text only. No bold, italics, or emojis.`;

const EXTRACTION_PROMPT = (userMessage: string, context: string) => `Extract structured preferences from user input. Return ONLY valid JSON.
User message: "${userMessage}"
Current known context: ${context}

Return this exact JSON structure:
{
 "intent": "reading_nook" | "book_storage" | "workspace" | "dining" | null,
 "room": "living_room" | "bedroom" | "office" | null,
 "space": "dimension string or null",
 "budget": {
 "min": number | null,
 "max": number | null
 },
 "aesthetic": ["cozy", "modern", "boho", "minimalist", etc.],
 "product_type": "armchair" | "side_table" | "floor_lamp" | null,
 "user_said_you_decide": boolean
}

EXTRACTION RULES:
- Only extract explicitly mentioned information
- Budget examples: "$800" → {"max": 800}, "under $800" → {"max": 800}, "$500-800" → {"min": 500, "max": 800}
- Aesthetic: extract feeling words only (cozy, warm, modern, minimalist, boho, rustic, elegant)
- Don't infer or assume - only stated facts
- Leave fields null if not mentioned
- Set user_said_you_decide to true if the user explicitly asks you to make the decision or says "you decide"`;

const RECOMMENDATION_PROMPT = (context: any, products: any) => `Select 3 products from the provided catalog that best match user preferences.
USER PREFERENCES:
Budget: ${context.budget.max}
Aesthetic: ${context.aesthetic.join(', ')}
Space constraint: ${context.space}
Intent: ${context.intent}

AVAILABLE PRODUCTS (JSON):
${JSON.stringify(products)}

Return ONLY valid JSON:
{
 "recommendations": [
 {
 "product_id": "...",
 "match_reason": "one sentence explaining fit with their FUZZY GOAL",
 "key_callout": "one feature relevant to their stated needs"
 }
 ]
}

MATCHING PRIORITY:
1. Budget fit (never exceed max)
2. Aesthetic tag overlap (at least 1 matching tag)
3. Appropriate for stated intent
4. Space fit if dimensions were provided

MATCH REASONS MUST:
- Reference their ORIGINAL fuzzy goal, not generic features
- Example: "The deep seat creates that cozy reading feeling you want"
- NOT: "This is a comfortable chair"`;

// --- Components ---

const QuickReplies = ({ options, onSelect }: { options: string[]; onSelect: (option: string) => void }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 p-4 bg-white border-t border-[#E0E0E0] shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
    >
      <p className="text-[10px] uppercase tracking-widest text-[#666] font-semibold mb-1">Suggestions</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option, i) => (
          <button
            key={i}
            onClick={() => onSelect(option)}
            className="px-4 py-2 bg-[#F8FAFC] border border-[#E2E8F0] text-[#2D5B7B] rounded-xl text-xs font-medium hover:bg-[#2D5B7B] hover:text-white hover:border-[#2D5B7B] transition-all shadow-sm flex items-center gap-2"
          >
            <ChevronRight size={12} />
            {option}
          </button>
        ))}
      </div>
    </motion.div>
  );
};

const ProductCard = ({ 
  product, 
  recommendation, 
  onSelect, 
  onDetails 
}: { 
  product: Product; 
  recommendation: any; 
  onSelect: (name: string) => void;
  onDetails: (product: Product) => void;
  key?: React.Key;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-shrink-0 w-[280px] bg-white rounded-2xl border border-[#E0E0E0] overflow-hidden shadow-sm mr-4 flex flex-col"
    >
      <div className="relative group">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-[240px] object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button 
            onClick={() => onDetails(product)}
            className="p-2 bg-white rounded-full text-[#1A1A1A] hover:bg-[#F0F0F0] transition-colors"
          >
            <Info size={18} />
          </button>
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-semibold text-base text-[#1A1A1A] line-clamp-1">{product.name}</h3>
          <span className="font-bold text-[#2D5B7B]">${product.price}</span>
        </div>
        <div className="flex items-center gap-1 mb-2 text-xs text-amber-500">
          <Star size={12} fill="currentColor" />
          <span className="font-medium">{product.rating}</span>
        </div>
        <p className="text-xs text-[#666] mb-4 line-clamp-2 italic leading-relaxed">
          "{recommendation.match_reason}"
        </p>
        <div className="mt-auto flex gap-2">
          <button
            onClick={() => onSelect(product.name)}
            className="flex-1 py-2 bg-[#2D5B7B] text-white rounded-xl text-xs font-medium hover:bg-[#1E3D51] transition-colors"
          >
            Select
          </button>
          <button
            onClick={() => onDetails(product)}
            className="px-3 py-2 border border-[#E0E0E0] text-[#666] rounded-xl text-xs font-medium hover:bg-[#F0F0F0] transition-colors"
          >
            Details
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const AssistantReply = ({ 
  message, 
  onSelectProduct, 
  onViewDetails 
}: { 
  message: Message; 
  onSelectProduct: (name: string) => void;
  onViewDetails: (product: Product) => void;
  key?: React.Key;
}) => {
  return (
    <div className="flex flex-col w-full mb-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start mb-4"
      >
        <div className="max-w-[85%] p-4 rounded-2xl bg-[#E8F4F8] text-[#1A1A1A] rounded-tl-none text-sm leading-relaxed shadow-sm">
          {message.content}
        </div>
      </motion.div>

      {message.products && message.products.length > 0 && (
        <div className="w-full overflow-x-auto no-scrollbar py-2 -mx-4 px-4 flex snap-x">
          {message.products.map((rec) => {
            const product = catalogData.find(p => p.product_id === rec.product_id);
            if (!product) return null;
            return (
              <ProductCard 
                key={product.product_id} 
                product={product as Product} 
                recommendation={rec} 
                onSelect={onSelectProduct}
                onDetails={onViewDetails}
              />
            );
          })}
          <div className="flex-shrink-0 w-4" />
        </div>
      )}
      
      {/* Future AR slot could go here */}
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [state, setState] = useState<ConversationState>({
    stage: 'broad',
    context: {
      intent: null,
      room: null,
      space: null,
      budget: { min: null, max: null },
      aesthetic: [],
      product_type: null,
    },
    products_shown: false,
    selected_products: [],
    history: [
      {
        role: 'assistant',
        content: "Hi there! I'm Lumi, your furniture discovery assistant. What kind of space are you dreaming of creating today?",
        timestamp: new Date().toISOString(),
      },
    ],
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  useEffect(() => {
    if (scrollRef.current) {
      // Use a small delay to ensure content is rendered before scrolling
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [state.history, isTyping, state.products_shown]);

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim() || isTyping) return;

    const userMessage: Message = {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
    };

    const newHistory = [...state.history, userMessage];
    setState((prev) => ({ ...prev, history: newHistory }));
    setInput('');
    setIsTyping(true);

    try {
      // 1. Extract context
      const extractionResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: EXTRACTION_PROMPT(textToSend, JSON.stringify(state.context)),
        config: { responseMimeType: "application/json" },
      });

      const extractedContext = JSON.parse(extractionResponse.text || '{}');
      
      // Merge context
      const updatedContext = {
        ...state.context,
        ...extractedContext,
        budget: {
          min: extractedContext.budget?.min ?? state.context.budget.min,
          max: extractedContext.budget?.max ?? state.context.budget.max,
        },
        aesthetic: Array.from(new Set([...state.context.aesthetic, ...(extractedContext.aesthetic || [])])),
      };

      // 2. Determine Stage Transition
      let nextStage = state.stage;
      if (state.stage === 'broad' && updatedContext.intent) {
        nextStage = 'contextual';
      } else if (state.stage === 'contextual' && (updatedContext.room || updatedContext.space)) {
        nextStage = 'preferences';
      } else if (state.stage === 'preferences' && updatedContext.budget.max && updatedContext.aesthetic.length > 0) {
        nextStage = 'specific';
      }

      // Handle "you decide"
      if (extractedContext.user_said_you_decide && updatedContext.intent && updatedContext.aesthetic.length > 0) {
        // If they say "you decide", we can jump to specific if we have enough info
        if (!updatedContext.budget.max) {
           // Maybe suggest a budget? The prompt says "Make a decision based on what you know"
           // For now, let's let the assistant handle the text response.
        }
      }

      // 3. Check for Visual Trigger
      let productsForThisTurn: any[] = [];
      let productsShown = state.products_shown;

      if (nextStage === 'specific' && !state.products_shown) {
        const recommendationResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: RECOMMENDATION_PROMPT(updatedContext, catalogData),
          config: { responseMimeType: "application/json" },
        });
        const recommendations = JSON.parse(recommendationResponse.text || '{"recommendations":[]}');
        productsForThisTurn = recommendations.recommendations;
        productsShown = true;
      }

      // 4. Generate Conversational Response
      const chat = ai.chats.create({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: `${SYSTEM_INSTRUCTION}\n\nWhat you know so far:\n${JSON.stringify(updatedContext, null, 2)}`,
        },
      });

      const response = await chat.sendMessage({
        message: textToSend,
      });

      let rawContent = response.text || "I'm sorry, I didn't quite catch that. Could you say it again?";
      
      // Parse Quick Replies: [Option 1 | Option 2]
      let quickReplies: string[] = [];
      const qrMatch = rawContent.match(/\[(.*?)\]/);
      if (qrMatch) {
        quickReplies = qrMatch[1].split('|').map(s => s.trim());
        rawContent = rawContent.replace(/\[.*?\]/, '').trim();
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: rawContent,
        timestamp: new Date().toISOString(),
        quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
        products: productsForThisTurn.length > 0 ? productsForThisTurn : undefined,
      };

      setState((prev) => ({
        ...prev,
        stage: nextStage,
        context: updatedContext,
        products_shown: productsShown,
        history: [...newHistory, assistantMessage],
      }));

    } catch (error) {
      console.error("Error in Lumi:", error);
      const errorMessage: Message = {
        role: 'assistant',
        content: "I'm having a little trouble connecting right now. Could you try again in a moment?",
        timestamp: new Date().toISOString(),
      };
      setState((prev) => ({ ...prev, history: [...prev.history, errorMessage] }));
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-[#1A1A1A] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-bottom border-[#E0E0E0] bg-white z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#2D5B7B] rounded-lg flex items-center justify-center text-white">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Lumi</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#666] font-medium">
              {state.stage} stage
            </p>
          </div>
        </div>
        <button className="p-2 text-[#666] hover:bg-[#F0F0F0] rounded-full transition-colors">
          <Info size={20} />
        </button>
      </header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scroll-smooth"
      >
        <AnimatePresence initial={false}>
          {state.history.map((msg, i) => (
            msg.role === 'assistant' ? (
              <AssistantReply 
                key={i} 
                message={msg} 
                onSelectProduct={(name) => handleSend(`I'd like to select the ${name}`)}
                onViewDetails={(p) => setSelectedProduct(p)}
              />
            ) : (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex justify-end mb-4"
              >
                <div className="max-w-[75%] p-4 rounded-2xl bg-[#F0F0F0] text-[#1A1A1A] rounded-tr-none text-sm leading-relaxed shadow-sm">
                  {msg.content}
                </div>
              </motion.div>
            )
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start mb-4"
          >
            <div className="bg-[#E8F4F8] p-4 rounded-2xl rounded-tl-none flex gap-1">
              <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-[#2D5B7B] rounded-full" />
              <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-[#2D5B7B] rounded-full" />
              <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-[#2D5B7B] rounded-full" />
            </div>
          </motion.div>
        )}
      </main>

      {/* Product Details Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setSelectedProduct(null)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-64 sm:h-80">
                <img 
                  src={selectedProduct.image_url} 
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={() => setSelectedProduct(null)}
                  className="absolute top-4 right-4 w-8 h-8 bg-black/20 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-black/40 transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-[#1A1A1A]">{selectedProduct.name}</h2>
                    <p className="text-[#666] text-sm uppercase tracking-wider">{selectedProduct.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-[#2D5B7B]">${selectedProduct.price}</p>
                    <div className="flex items-center justify-end gap-1 text-amber-500">
                      <Star size={14} fill="currentColor" />
                      <span className="text-sm font-semibold">{selectedProduct.rating}</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4 mb-8">
                  <div>
                    <h4 className="text-xs font-bold uppercase text-[#999] tracking-widest mb-2">Description</h4>
                    <p className="text-sm text-[#444] leading-relaxed">{selectedProduct.user_friendly_description}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase text-[#999] tracking-widest mb-2">Key Features</h4>
                    <ul className="grid grid-cols-1 gap-2">
                      {selectedProduct.key_features.map((f, i) => (
                        <li key={i} className="text-sm text-[#444] flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-[#D4A574] rounded-full" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <button
                  onClick={() => {
                    handleSend(`I've decided on the ${selectedProduct.name}!`);
                    setSelectedProduct(null);
                  }}
                  className="w-full py-4 bg-[#2D5B7B] text-white rounded-2xl font-bold hover:bg-[#1E3D51] transition-colors shadow-lg"
                >
                  Select This Product
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Replies Modal-like Extension */}
      {state.history[state.history.length - 1]?.role === 'assistant' && state.history[state.history.length - 1]?.quickReplies && (
        <QuickReplies 
          options={state.history[state.history.length - 1].quickReplies!} 
          onSelect={(option) => handleSend(option)} 
        />
      )}

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-[#E0E0E0]">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Describe your dream space..."
              className="w-full h-12 pl-4 pr-12 bg-[#F0F0F0] border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#2D5B7B]/20 focus:outline-none transition-all"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`absolute right-1.5 top-1.5 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                input.trim() && !isTyping ? 'bg-[#2D5B7B] text-white' : 'bg-[#E0E0E0] text-[#666]'
              }`}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
        <p className="text-[10px] text-center text-[#999] mt-3 uppercase tracking-widest font-medium">
          Powered by Gemini 2.0 Flash
        </p>
      </footer>

      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
