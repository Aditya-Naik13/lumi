/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, ChevronRight, Info, Star, X } from 'lucide-react';
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
  bg: '#FAFAFA',
  text: '#111111',
  textSecondary: '#767676',
  userBubble: '#EBEBEB',
  assistantBubble: '#FFFFFF',
  accentPrimary: '#0058A3',
  accentYellow: '#FFDB00',
  border: '#E0E0E0',
  surface: '#FFFFFF',
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 px-4 py-3 bg-white border-t border-[#E0E0E0]"
    >
      <p className="text-[10px] uppercase tracking-widest text-[#767676] font-semibold">Suggestions</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option, i) => (
          <button
            key={i}
            onClick={() => onSelect(option)}
            className="px-3 py-1.5 bg-white border border-[#0058A3] text-[#0058A3] rounded text-xs font-medium hover:bg-[#0058A3] hover:text-white transition-colors flex items-center gap-1.5"
          >
            <ChevronRight size={11} />
            {option}
          </button>
        ))}
      </div>
    </motion.div>
  );
};

// Mobile inline product card (compact)
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
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-shrink-0 w-[220px] bg-white border border-[#E0E0E0] overflow-hidden mr-3 flex flex-col rounded"
    >
      <div className="relative group">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-[150px] object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={() => onDetails(product)}
            className="p-1.5 bg-white text-[#111111] hover:bg-[#F5F5F5] transition-colors"
          >
            <Info size={16} />
          </button>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-1 gap-2">
          <h3 className="font-bold text-sm text-[#111111] line-clamp-1 flex-1 leading-tight">{product.name}</h3>
          <span className="font-bold text-sm text-[#0058A3] flex-shrink-0">${product.price}</span>
        </div>
        <div className="flex items-center gap-1 mb-2">
          <Star size={10} fill="currentColor" className="text-[#FFDB00]" />
          <span className="text-xs text-[#767676]">{product.rating}</span>
        </div>
        <p className="text-xs text-[#555555] mb-3 line-clamp-2 leading-relaxed">
          {recommendation.match_reason}
        </p>
        <div className="mt-auto flex gap-1.5">
          <button
            onClick={() => onSelect(product.name)}
            className="flex-1 py-1.5 bg-[#0058A3] text-white rounded text-xs font-semibold hover:bg-[#004F99] transition-colors"
          >
            Select
          </button>
          <button
            onClick={() => onDetails(product)}
            className="px-2 py-1.5 border border-[#E0E0E0] text-[#767676] rounded text-xs hover:bg-[#F5F5F5] transition-colors"
          >
            Details
          </button>
        </div>
      </div>
    </motion.div>
  );
};

// Desktop gallery card (larger, showroom feel)
const GalleryCard = ({
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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-[#E0E0E0] overflow-hidden flex flex-col group rounded"
    >
      <div className="relative overflow-hidden">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full aspect-square object-cover group-hover:scale-103 transition-transform duration-500"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        <button
          onClick={() => onDetails(product)}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-white p-1.5 shadow-sm hover:bg-[#F5F5F5]"
        >
          <Info size={14} className="text-[#111111]" />
        </button>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start gap-2 mb-1">
          <h3 className="font-bold text-sm text-[#111111] leading-tight line-clamp-2 flex-1">{product.name}</h3>
          <span className="font-bold text-sm text-[#0058A3] flex-shrink-0">${product.price}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <Star size={11} fill="currentColor" className="text-[#FFDB00]" />
          <span className="text-xs text-[#767676]">{product.rating}</span>
          <span className="text-[#DFDFDF] mx-0.5">·</span>
          <span className="text-[10px] uppercase tracking-wider text-[#767676]">{product.category}</span>
        </div>
        <p className="text-xs text-[#555555] mb-4 leading-relaxed line-clamp-2">
          {recommendation.match_reason}
        </p>
        <div className="mt-auto flex gap-2">
          <button
            onClick={() => onSelect(product.name)}
            className="flex-1 py-2 bg-[#0058A3] text-white text-xs font-bold hover:bg-[#004F99] transition-colors uppercase tracking-wider rounded"
          >
            Select
          </button>
          <button
            onClick={() => onDetails(product)}
            className="px-3 py-2 border border-[#E0E0E0] text-[#767676] text-xs hover:bg-[#F5F5F5] transition-colors rounded"
          >
            Details
          </button>
        </div>
      </div>
    </motion.div>
  );
};

// Desktop left gallery panel
const GalleryPanel = ({
  allProducts,
  onSelect,
  onDetails,
}: {
  allProducts: { product: Product; rec: any }[];
  onSelect: (name: string) => void;
  onDetails: (product: Product) => void;
}) => {
  return (
    <div className="flex flex-1 flex-col h-full bg-[#FAFAFA] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E0E0E0] bg-white flex-shrink-0">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#767676]">Gallery</h2>
        {allProducts.length > 0 && (
          <p className="text-xs text-[#AAAAAA] mt-0.5">
            {allProducts.length} item{allProducts.length !== 1 ? 's' : ''} recommended
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {allProducts.length === 0 ? (
          <div className="h-full flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#F0F0F0] rounded-full mx-auto mb-4 flex items-center justify-center">
                <Sparkles size={24} className="text-[#CCCCCC]" />
              </div>
              <p className="text-sm font-medium text-[#999999]">Your selections will appear here</p>
              <p className="text-xs text-[#BBBBBB] mt-1">Start a conversation to discover furniture</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <AnimatePresence>
              {allProducts.map(({ product, rec }) => (
                <GalleryCard
                  key={product.product_id}
                  product={product}
                  recommendation={rec}
                  onSelect={onSelect}
                  onDetails={onDetails}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
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
    <div className="flex flex-col w-full mb-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start mb-3"
      >
        <div className="max-w-[85%] px-4 py-3 bg-white border border-[#E0E0E0] text-[#111111] rounded text-sm leading-relaxed">
          {message.content}
        </div>
      </motion.div>

      {/* Products — shown inline on mobile, hidden on desktop (shown in gallery instead) */}
      {message.products && message.products.length > 0 && (
        <div className="md:hidden w-full overflow-x-auto no-scrollbar py-2 -mx-4 px-4 flex snap-x">
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
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    }
  }, [state.history, isTyping, state.products_shown]);

  // Derive all products from history for the desktop gallery
  const allGalleryProducts = state.history
    .filter(m => m.products?.length)
    .flatMap(m =>
      (m.products ?? []).map(rec => {
        const product = catalogData.find(p => p.product_id === rec.product_id) as Product | undefined;
        return product ? { product, rec } : null;
      })
    )
    .filter((x): x is { product: Product; rec: any } => x !== null);

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
        if (!updatedContext.budget.max) {
          // Let the assistant handle the text response
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

  const lastMessage = state.history[state.history.length - 1];
  const showQuickReplies = lastMessage?.role === 'assistant' && lastMessage?.quickReplies;

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Left gallery panel — desktop only */}
      <div className="hidden md:flex flex-1 flex-col border-r border-[#E0E0E0] min-w-0">
        <GalleryPanel
          allProducts={allGalleryProducts}
          onSelect={(name) => handleSend(`I'd like to select the ${name}`)}
          onDetails={(p) => setSelectedProduct(p)}
        />
      </div>

      {/* Right chat column — full width on mobile, fixed width on desktop */}
      <div className="flex flex-col w-full md:w-[440px] md:flex-shrink-0 h-screen overflow-hidden bg-white">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-[#E0E0E0] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#0058A3] flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-[#111111] leading-none">Lumi</h1>
              <p className="text-[10px] uppercase tracking-widest text-[#767676] font-medium mt-0.5">
                {state.stage} stage
              </p>
            </div>
          </div>
          <button className="p-2 text-[#767676] hover:text-[#111111] hover:bg-[#F5F5F5] transition-colors rounded">
            <Info size={18} />
          </button>
        </header>

        {/* Chat area */}
        <main
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-5 bg-[#FAFAFA] scroll-smooth"
        >
          <AnimatePresence initial={false}>
            {state.history.map((msg, i) =>
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
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex justify-end mb-4"
                >
                  <div className="max-w-[75%] px-4 py-3 bg-[#EBEBEB] text-[#111111] rounded text-sm leading-relaxed">
                    {msg.content}
                  </div>
                </motion.div>
              )
            )}
          </AnimatePresence>

          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start mb-4"
            >
              <div className="bg-white border border-[#E0E0E0] px-4 py-3 rounded flex gap-1.5">
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-1.5 h-1.5 bg-[#767676] rounded-full"
                />
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                  className="w-1.5 h-1.5 bg-[#767676] rounded-full"
                />
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                  className="w-1.5 h-1.5 bg-[#767676] rounded-full"
                />
              </div>
            </motion.div>
          )}
        </main>

        {/* Quick replies */}
        {showQuickReplies && (
          <QuickReplies
            options={lastMessage.quickReplies!}
            onSelect={(option) => handleSend(option)}
          />
        )}

        {/* Input area */}
        <footer className="px-4 py-3 bg-white border-t border-[#E0E0E0] flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Describe your dream space..."
              className="flex-1 h-11 px-4 bg-[#F5F5F5] border border-transparent text-sm text-[#111111] placeholder:text-[#AAAAAA] focus:border-[#0058A3] focus:bg-white focus:outline-none transition-all rounded"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className={`w-11 h-11 flex items-center justify-center transition-colors flex-shrink-0 rounded ${
                input.trim() && !isTyping
                  ? 'bg-[#0058A3] text-white hover:bg-[#004F99]'
                  : 'bg-[#E0E0E0] text-[#AAAAAA] cursor-not-allowed'
              }`}
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-[10px] text-center text-[#BBBBBB] mt-2 uppercase tracking-widest font-medium">
            Powered by Gemini
          </p>
        </footer>
      </div>

      {/* Product Details Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setSelectedProduct(null)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="bg-white w-full max-w-lg overflow-hidden shadow-2xl rounded"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative h-64 sm:h-72">
                <img
                  src={selectedProduct.image_url}
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="absolute top-3 right-3 w-8 h-8 bg-white/90 text-[#111111] flex items-center justify-center hover:bg-white transition-colors shadow-sm"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-[#111111] leading-tight">{selectedProduct.name}</h2>
                    <p className="text-xs text-[#767676] uppercase tracking-wider mt-1">{selectedProduct.category}</p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-xl font-bold text-[#0058A3]">${selectedProduct.price}</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <Star size={12} fill="currentColor" className="text-[#FFDB00]" />
                      <span className="text-sm text-[#767676] font-medium">{selectedProduct.rating}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mb-6">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-[#999999] tracking-widest mb-2">Description</h4>
                    <p className="text-sm text-[#444444] leading-relaxed">{selectedProduct.user_friendly_description}</p>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold uppercase text-[#999999] tracking-widest mb-2">Key Features</h4>
                    <ul className="grid grid-cols-1 gap-1.5">
                      {selectedProduct.key_features.map((f, i) => (
                        <li key={i} className="text-sm text-[#444444] flex items-center gap-2">
                          <div className="w-1 h-1 bg-[#0058A3] rounded-full flex-shrink-0" />
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
                  className="w-full py-3.5 bg-[#0058A3] text-white font-bold hover:bg-[#004F99] transition-colors text-sm uppercase tracking-wider rounded"
                >
                  Select This Product
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
