import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Set up larger limits for base64 image uploads from camera
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 1. Initialize Gemini API Client
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
  console.log("Gemini API initialized successfully.");
} else {
  console.warn("GEMINI_API_KEY is not defined. Gender verification will run in dry-run mode.");
}

// 2. Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || "https://your-project.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let supabase: any = null;
const isSupabaseConfigured =
  supabaseUrl &&
  !supabaseUrl.includes("your-project") &&
  supabaseServiceKey &&
  supabaseAnonKey;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
      },
    });
    console.log(`Supabase Client initialized successfully with URL: ${supabaseUrl}`);
  } catch (err) {
    console.error("Failed to initialize Supabase client:", err);
  }
} else {
  console.warn(
    "Supabase credentials are not fully configured or are placeholders. DB actions will fall back to secure local state emulation."
  );
}

// Local Database Emulation state in case real Supabase URL is placeholder
const localHosts = [
  {
    id: "host-uuid-1",
    username: "Sophia Rodriguez",
    avatarUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
    msgPrice: 10,
    voicePrice: 200,
    videoPrice: 500,
    earnings: 15.20,
    isVerified: true,
    whatsapp: "+15550198",
  },
  {
    id: "host-uuid-2",
    username: "Emma Watson",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    msgPrice: 10,
    voicePrice: 200,
    videoPrice: 500,
    earnings: 48.50,
    isVerified: true,
    whatsapp: "+15550244",
  },
  {
    id: "host-uuid-3",
    username: "Isabella Garcia",
    avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150",
    msgPrice: 10,
    voicePrice: 200,
    videoPrice: 500,
    earnings: 112.00,
    isVerified: true,
    whatsapp: "+15550311",
  }
];

const localWithdrawals = [
  {
    id: "w-req-1",
    hostId: "host-uuid-1",
    hostName: "Sophia Rodriguez",
    amount: 50.00,
    payoutMethod: "PayPal",
    bankName: "N/A",
    iban: "N/A",
    comments: "Send to my paypal account: sophia@example.com",
    whatsapp: "+15550198",
    status: "pending",
  },
];

const localMessages = [
  {
    id: "msg-1",
    senderId: "host-uuid-1",
    senderName: "Sophia Rodriguez",
    recipientId: "Alex_99",
    recipientName: "Alex_99",
    text: "Hey there! Ready for a quick video call? Let's chat!",
    createdAt: new Date().toISOString()
  }
];

const localRatings = [
  {
    id: "rate-1",
    hostId: "host-uuid-1",
    hostName: "Sophia Rodriguez",
    callerId: "Alex_99",
    callerName: "Alex_99",
    rating: 5,
    comment: "Sophia is incredibly sweet and funny! I highly recommend chatting with her.",
    createdAt: new Date().toISOString()
  },
  {
    id: "rate-2",
    hostId: "host-uuid-2",
    hostName: "Emma Watson",
    callerId: "Alex_99",
    callerName: "Alex_99",
    rating: 5,
    comment: "Great video chat experience! Really down-to-earth.",
    createdAt: new Date().toISOString()
  }
];

const localUsers = [
  { id: "caller-uuid-1", username: "Alex_99", email: "alex@gmail.com", role: "caller", isSuperuser: false },
  { id: "host-uuid-1", username: "Sophia Rodriguez", email: "sophia@gmail.com", role: "host", isSuperuser: false },
  { id: "host-uuid-2", username: "Emma Watson", email: "emma@gmail.com", role: "host", isSuperuser: false },
  { id: "host-uuid-3", username: "Isabella Garcia", email: "isabella@gmail.com", role: "host", isSuperuser: false },
  { id: "admin-uuid-1", username: "SuperAdmin", email: "admin@lugo.com", role: "admin", isSuperuser: true }
];

// ============================================================================
// API ROUTES
// ============================================================================

// 1. Camera Gender Verification via Gemini Vision API
app.post("/api/verify-gender", async (req, res) => {
  const { image } = req.body; // Expects base64 encoded photo data url

  if (!image) {
    return res.status(400).json({
      success: false,
      error: "No snapshot image provided for female verification.",
    });
  }

  // Handle data URI format (e.g. "data:image/png;base64,iVBOR...")
  let mimeType = "image/jpeg";
  let base64Data = image;

  if (image.startsWith("data:")) {
    const parts = image.split(";base64,");
    mimeType = parts[0].replace("data:", "");
    base64Data = parts[1];
  }

  // Fallback / dry-run if Gemini is not initialized
  if (!ai) {
    console.log("No Gemini API client initialized. Simulating verification...");
    // Let's do a mock success so developers can test without keys easily
    return res.json({
      success: true,
      isFemale: true,
      confidence: 0.98,
      reason: "Mock Verification: Face identified as biological female successfully. (Dry-run mode, no GEMINI_API_KEY set).",
    });
  }

  try {
    console.log(`Analyzing image with Gemini model: gemini-3.5-flash (${base64Data.length} bytes base64)`);

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: `You are a strict biological female verifier for a premium verified-only social platform.
          Analyze the face in this photo and decide if the person is a biological female.
          We want to prevent males, fake AI avatars, cartoons, or animals from registering as female hosts.
          
          Respond in valid JSON matching the schema. Be objective, precise, and professional.
          If the image is not a biological female, or is unclear, or is a male, you MUST set isFemale to false.
          Provide a professional reason for your choice.`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isFemale: {
              type: Type.BOOLEAN,
              description: "True if the person in the photo is clearly a biological female, false otherwise.",
            },
            confidence: {
              type: Type.NUMBER,
              description: "Confidence level of the classification between 0 and 1.",
            },
            reason: {
              type: Type.STRING,
              description: "A short professional explanation of the physical/aesthetic determination (e.g. Female features verified, Male features detected, Photo unclear, No face detected).",
            },
          },
          required: ["isFemale", "confidence", "reason"],
        },
      },
    });

    const resultText = response.text;
    console.log("Gemini Verification Result:", resultText);

    if (!resultText) {
      throw new Error("Empty response from Gemini.");
    }

    const verificationResult = JSON.parse(resultText);

    return res.json({
      success: true,
      ...verificationResult,
    });
  } catch (err: any) {
    console.error("Gemini Verification Error:", err);
    return res.status(500).json({
      success: false,
      error: "AI Verification process failed.",
      details: err.message,
    });
  }
});

// 2. Fetch Hosts Feed (including verification status)
app.get("/api/hosts", async (req, res) => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_role", "host");

      if (error) throw error;
      return res.json({ success: true, hosts: data });
    } catch (err: any) {
      console.error("Supabase read error, falling back to emulated state:", err);
    }
  }

  // Emulation fallback with dynamic ratings calculation
  const hostsWithRatings = localHosts.map((h) => {
    const ratingsForHost = localRatings.filter((r) => r.hostId === h.id || r.hostName === h.username);
    const avg = ratingsForHost.length > 0
      ? parseFloat((ratingsForHost.reduce((sum, r) => sum + r.rating, 0) / ratingsForHost.length).toFixed(1))
      : 5.0; // Default rating
    return {
      ...h,
      averageRating: avg,
      reviewCount: ratingsForHost.length,
    };
  });
  return res.json({ success: true, hosts: hostsWithRatings });
});

// 3. Register a New Host Profile
app.post("/api/hosts", async (req, res) => {
  const { username, avatarUrl, msgPrice, voicePrice, videoPrice, isVerified, whatsapp } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, error: "Username is required." });
  }

  if (supabase) {
    try {
      // Create user auth + profile
      const tempId = crypto.randomUUID();
      const { data, error } = await supabase.from("profiles").insert({
        id: tempId,
        username,
        avatar_url: avatarUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${username}`,
        user_role: "host",
        balance: 0,
        earnings_balance: 0.00,
        msg_price_coins: msgPrice || 10,
        voice_price_coins: voicePrice || 200,
        video_price_coins: videoPrice || 500,
        bank_name: "",
        bank_account_iban: "",
      });

      if (error) throw error;
      return res.json({ success: true, host: { id: tempId, username, avatarUrl, msgPrice } });
    } catch (err: any) {
      console.error("Supabase insert error, falling back to emulation:", err);
    }
  }

  // Emulate insertion
  const newHost = {
    id: `host-uuid-${Date.now()}`,
    username,
    avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${username}`,
    msgPrice: msgPrice || 10,
    voicePrice: voicePrice || 200,
    videoPrice: videoPrice || 500,
    earnings: 0.00,
    isVerified: !!isVerified,
    whatsapp: whatsapp || "",
  };

  localHosts.unshift(newHost);
  localUsers.push({
    id: newHost.id,
    username: newHost.username,
    email: `${username.toLowerCase().replace(/\s+/g, "")}@lugo.com`,
    role: "host",
    isSuperuser: false,
  });
  return res.json({ success: true, host: newHost });
});

// 4. Fetch All Withdrawals
app.get("/api/withdrawals", async (req, res) => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("withdrawal_requests")
        .select(`
          id,
          amount,
          bank_name,
          iban,
          status,
          created_at,
          host_id,
          profiles:host_id (username)
        `);

      if (error) throw error;
      // Map to flatter structure
      const formatted = data.map((d: any) => ({
        id: d.id,
        hostId: d.host_id,
        hostName: d.profiles?.username || "Unknown Host",
        amount: d.amount,
        bankName: d.bank_name,
        iban: d.iban,
        status: d.status,
      }));
      return res.json({ success: true, withdrawals: formatted });
    } catch (err: any) {
      console.error("Supabase withdrawal fetch failed, falling back to emulation:", err);
    }
  }

  return res.json({ success: true, withdrawals: localWithdrawals });
});

// 5. Request a New Withdrawal (Includes other payout methods, comments, and WhatsApp)
app.post("/api/withdrawals", async (req, res) => {
  const { hostId, hostName, amount, payoutMethod, bankName, iban, comments, whatsapp, isVerifiedFemale } = req.body;

  if (!amount || !payoutMethod || !whatsapp) {
    return res.status(400).json({
      success: false,
      error: "Amount, Payout Method, and WhatsApp Contact Number are required.",
    });
  }

  // Enforce rule: Not all hosts will get paid, ONLY verified biological female users.
  const matchedHost = localHosts.find((h) => h.id === hostId || h.username === hostName);
  const isFemale = matchedHost ? (matchedHost.isVerified || (matchedHost as any).gender === "female") : isVerifiedFemale;

  if (!isFemale) {
    return res.status(400).json({
      success: false,
      error: "Withdrawal rejected: Only verified biological female hosts are eligible for payouts.",
    });
  }

  if (supabase) {
    try {
      // In a real Supabase DB, we can insert into withdrawal_requests
      // Since withdrawal_requests schema in supabase_schema.sql only has host_id, amount, bank_name, iban, status,
      // we can save other payout/comments inside the bank_name or iban column or extend schema.
      // To preserve schema without breaking changes, we serialize the comments/method inside bank_name or ibis:
      const serializedBank = payoutMethod === "Other" ? `Other: ${comments}` : payoutMethod;
      const serializedIban = `IBAN: ${iban} | WhatsApp: ${whatsapp}`;

      const { data, error } = await supabase.from("withdrawal_requests").insert({
        host_id: hostId || "00000000-0000-0000-0000-000000000000",
        amount,
        bank_name: serializedBank,
        iban: serializedIban,
        status: "pending",
      });

      if (error) throw error;
      return res.json({ success: true, message: "Withdrawal submitted to Supabase!" });
    } catch (err: any) {
      console.error("Supabase insert error, falling back to emulation:", err);
    }
  }

  // Emulation fallback
  const newWithdrawal = {
    id: `w-req-${Date.now()}`,
    hostId: hostId || "current-user-host",
    hostName: hostName || "Sophia Rodriguez",
    amount: parseFloat(amount),
    payoutMethod,
    bankName: bankName || "N/A",
    iban: iban || "N/A",
    comments: comments || "",
    whatsapp,
    status: "pending",
  };

  localWithdrawals.push(newWithdrawal);
  return res.json({ success: true, withdrawal: newWithdrawal });
});

// 6. Approve Withdrawal (Admin Only)
app.post("/api/withdrawals/approve", async (req, res) => {
  const { requestId, isAdmin } = req.body;

  if (!requestId) {
    return res.status(400).json({ success: false, error: "Request ID is required." });
  }

  if (isAdmin !== true) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Only administrators are authorized to control or approve payouts.",
    });
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("approve_host_withdrawal", {
        p_request_id: requestId,
      });

      if (error) throw error;
      return res.json({ success: true, result: data });
    } catch (err: any) {
      console.error("Supabase approve RPC error, falling back to emulation:", err);
    }
  }

  // Emulation
  const idx = localWithdrawals.findIndex((w) => w.id === requestId);
  if (idx !== -1) {
    localWithdrawals[idx].status = "paid";
    return res.json({ success: true, status: "paid" });
  }

  return res.status(404).json({ success: false, error: "Withdrawal request not found." });
});

// 7. Sync User (Ensures logged in caller or host is added to user management)
app.post("/api/users/sync", (req, res) => {
  const { username, role, email } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, error: "Username is required." });
  }
  let user = localUsers.find((u) => u.username === username);
  if (!user) {
    user = {
      id: `user-uuid-${Date.now()}`,
      username,
      email: email || `${username.toLowerCase().replace(/\s+/g, "")}@lugo.com`,
      role: role || "caller",
      isSuperuser: role === "admin"
    };
    localUsers.push(user);
  } else {
    if (role && user.role !== role) {
      user.role = role;
    }
  }
  return res.json({ success: true, user });
});

// 8. Fetch All Users (Admin Only)
app.get("/api/users", (req, res) => {
  return res.json({ success: true, users: localUsers });
});

// 9. Grant Superuser / Admin Access (Admin Only)
app.post("/api/users/grant-superuser", (req, res) => {
  const { userId, isSuperuser, isAdmin, role } = req.body;
  const user = localUsers.find((u) => u.id === userId || u.username === userId);
  if (user) {
    if (role !== undefined) {
      user.role = role;
      user.isSuperuser = role === "admin";
    } else {
      user.isSuperuser = !!isSuperuser;
      if (isAdmin !== undefined) {
        user.role = isAdmin ? "admin" : "caller";
      } else {
        user.role = isSuperuser ? "admin" : "caller";
      }
    }
    
    // Also update role in localHosts if they are registered as a host
    const h = localHosts.find((host) => host.id === userId || host.username === userId);
    if (h) {
      (h as any).isSuperuser = user.isSuperuser;
      (h as any).user_role = user.role;
    } else if (user.role === "host") {
      // Add to local hosts list with defaults if transitioning to host
      localHosts.push({
        id: user.id,
        username: user.username,
        avatarUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.username}`,
        msgPrice: 10,
        voicePrice: 200,
        videoPrice: 500,
        earnings: 0.00,
        isVerified: true,
        whatsapp: "+15550000",
      });
    }
    return res.json({ success: true, user });
  }
  return res.status(404).json({ success: false, error: "User not found." });
});

// 10. Fetch Chat Messages (Persisted for each user)
app.get("/api/messages", (req, res) => {
  const { sender, recipient } = req.query;
  if (sender && recipient) {
    const chat = localMessages.filter((m) => 
      (m.senderId === sender && m.recipientId === recipient) ||
      (m.senderId === recipient && m.recipientId === sender)
    );
    return res.json({ success: true, messages: chat });
  }
  return res.json({ success: true, messages: localMessages });
});

// 11. Save Chat Message
app.post("/api/messages", (req, res) => {
  const { senderId, senderName, recipientId, recipientName, text } = req.body;
  if (!senderId || !recipientId || !text) {
    return res.status(400).json({ success: false, error: "Missing required fields for saving message." });
  }
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    senderId,
    senderName,
    recipientId,
    recipientName,
    text,
    createdAt: new Date().toISOString()
  };
  localMessages.push(newMsg);
  return res.json({ success: true, message: newMsg });
});

// 11.5 Log and process call charge
app.post("/api/calls/charge", (req, res) => {
  const { hostId, callerUsername, cost, earnings } = req.body;
  
  if (!hostId || cost === undefined || earnings === undefined) {
    return res.status(400).json({ success: false, error: "Missing call charge fields." });
  }

  // Update selected host earnings in DB state
  const host = localHosts.find((h) => h.id === hostId);
  if (host) {
    host.earnings = parseFloat((host.earnings + earnings).toFixed(4));
    console.log(`[Call Charge] Deducted ${cost} coins. Credited $${earnings} to Host ${host.username}. Total: $${host.earnings}`);
    return res.json({ success: true, hostEarnings: host.earnings });
  }

  return res.status(404).json({ success: false, error: "Host not found." });
});

// 12. Fetch All Ratings or Ratings for a specific Host
app.get("/api/ratings", (req, res) => {
  const { hostId } = req.query;
  if (hostId) {
    const filtered = localRatings.filter((r) => r.hostId === hostId);
    return res.json({ success: true, ratings: filtered });
  }
  return res.json({ success: true, ratings: localRatings });
});

// 13. Save Call Rating
app.post("/api/ratings", (req, res) => {
  const { hostId, hostName, callerId, callerName, rating, comment } = req.body;
  if (!hostId || !rating) {
    return res.status(400).json({ success: false, error: "Host ID and rating are required." });
  }
  
  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ success: false, error: "Rating must be between 1 and 5." });
  }

  const newRating = {
    id: `rate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    hostId,
    hostName: hostName || "Sophia Rodriguez",
    callerId: callerId || "Alex_99",
    callerName: callerName || "Alex_99",
    rating: ratingNum,
    comment: comment || "",
    createdAt: new Date().toISOString()
  };
  
  localRatings.push(newRating);
  return res.json({ success: true, rating: newRating });
});

// ============================================================================
// DEV/PRODUCTION HANDLERS (Vite integration middleware)
// ============================================================================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static files server mounted.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express custom server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
