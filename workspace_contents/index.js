// ============================================================
// index.js
// WhatsApp Delivery + Stock Management System
//
// IMPORTANT:
// ONE WHATSAPP MESSAGE = ONE ORDER
//
// Example:
// rahul
// 10 bolt
// 5 nut
// 20 washer
// 3 unknownitem
//
// Creates:
// ONE order
// FOUR order_items
//
// WhatsApp groups are ignored.
// Only authorized senders are processed.
// ============================================================

require("dotenv").config();

const {
    Client,
    LocalAuth
} = require("whatsapp-web.js");

const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");

const fs = require("fs");
const path = require("path");

const db = require("./database");

// ============================================================
// PATHS
// ============================================================

const DATA_DIR = path.join(
    __dirname,
    "data"
);

const STATUS_FILE = path.join(
    DATA_DIR,
    "whatsapp-status.json"
);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

// ============================================================
// STATUS
// ============================================================

function writeStatus(
    status,
    message = "",
    qr = null
) {
    try {
        fs.writeFileSync(
            STATUS_FILE,
            JSON.stringify(
                {
                    status,
                    message,
                    qr,
                    updatedAt:
                        new Date().toISOString()
                },
                null,
                2
            )
        );
    } catch (error) {
        console.error(
            "Unable to write WhatsApp status:",
            error.message
        );
    }
}

writeStatus(
    "STARTING",
    "Starting WhatsApp..."
);

// ============================================================
// GLOBAL WHATSAPP CLIENT
//
// IMPORTANT:
// This MUST be let, not const.
//
// A completely new Client is created after disconnect.
// ============================================================

let client = null;

let reconnectTimer = null;

let reconnectInProgress = false;

let initializeInProgress = false;

let shuttingDown = false;

let clientGeneration = 0;

const inFlightMessageIds = new Set();
const WHATSAPP_BUSINESS_ID = Number(process.env.WHATSAPP_BUSINESS_ID || 1);

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// ============================================================
// INDIA DATE / TIME
// ============================================================

function getIndiaDateTime() {
    const now = new Date();

    const dateFormatter =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

    const timeFormatter =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            }
        );

    return {
        date: dateFormatter.format(now),
        time: timeFormatter.format(now)
    };
}

// ============================================================
// MESSAGE ID
// ============================================================

function getMessageId(message) {
    const serialized =
        message?.id?._serialized ||
        message?._data?.id?._serialized;

    if (
        typeof serialized === "string" &&
        serialized.trim()
    ) {
        return serialized.trim();
    }

    const rawId =
        message?.id?.id ||
        message?._data?.id?.id;

    const remote =
        message?.id?.remote ||
        message?._data?.id?.remote ||
        message?.from ||
        "";

    if (rawId && remote) {
        return `${remote}_${rawId}`;
    }

    if (rawId) {
        return String(rawId);
    }

    return "";
}

// ============================================================
// DELIVERED TO
// ============================================================

function getDeliveredTo(body) {
    const lines =
        String(body || "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

    if (!lines.length) {
        return "Unknown";
    }

    return lines[0];
}

// ============================================================
// PARSE ORDER
// ============================================================
//
// First line:
// delivered_to
//
// Remaining:
// quantity item
//
// Example:
//
// rahul
// 10 bolt
// 5 nut
//
// ============================================================

function parseDeliveries(body) {
    const lines =
        String(body || "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

    if (lines.length < 2) {
        return [];
    }

    const deliveries = [];

    for (
        let index = 1;
        index < lines.length;
        index++
    ) {
        const line = lines[index];

        const match =
            line.match(
                /^(\d+(?:\.\d+)?)\s+(.+)$/
            );

        if (!match) {
            continue;
        }

        const quantity =
            Number(match[1]);

        const item =
            match[2].trim();

        if (
            !Number.isFinite(quantity) ||
            quantity <= 0 ||
            !item
        ) {
            continue;
        }

        deliveries.push({
            quantity,
            item
        });
    }

    return deliveries;
}

// ============================================================
// RESOLVE REAL PHONE NUMBER
// ============================================================
//
// @c.us = normal WhatsApp number
// @g.us = group
// @lid  = WhatsApp LID
// ============================================================

async function resolveRealPhoneNumber(
    message,
    waClient
) {
    const from =
        String(
            message?.from || ""
        );

    if (!from) {
        return null;
    }

    // NEVER process groups.
    if (from.endsWith("@g.us")) {
        return null;
    }

    // Normal WhatsApp number.
    if (from.endsWith("@c.us")) {
        return db.normalizePhone(
            from.replace(
                "@c.us",
                ""
            )
        );
    }

    // WhatsApp LID.
    if (from.endsWith("@lid")) {
        const lid =
            from.replace(
                "@lid",
                ""
            );

        // Check saved LID mapping first.
        try {
            const existing =
                await db.getPhoneFromLid(
                    lid
                );

            if (existing) {
                return existing;
            }
        } catch (error) {
            console.error(
                "LID database lookup error:",
                error.message
            );
        }

        // Ask WhatsApp for real phone.
        try {
            const result =
                await waClient.getContactLidAndPhone(
                    [from]
                );

            if (
                Array.isArray(result) &&
                result.length
            ) {
                const entry =
                    result[0];

                const phone =
                    entry?.pn ||
                    entry?.phone ||
                    entry?.phoneNumber;

                if (phone) {
                    const normalized =
                        db.normalizePhone(
                            phone
                        );

                    if (normalized) {
                        await db.saveLidPhone(
                            lid,
                            normalized
                        );

                        return normalized;
                    }
                }
            }
        } catch (error) {
            console.error(
                "Could not resolve LID:",
                error.message
            );
        }

        return null;
    }

    return null;
}

// ============================================================
// REFRESH LID -> PHONE MAP
// ============================================================

async function refreshLidPhoneMap(
    waClient
) {
    if (!waClient) {
        return;
    }

    try {
        const contacts =
            await waClient.getContacts();

        const batchSize = 100;

        for (
            let i = 0;
            i < contacts.length;
            i += batchSize
        ) {
            const batch =
                contacts.slice(
                    i,
                    i + batchSize
                );

            const ids =
                batch
                    .map(
                        contact =>
                            contact?.id?._serialized
                    )
                    .filter(Boolean);

            if (!ids.length) {
                continue;
            }

            try {
                const result =
                    await waClient.getContactLidAndPhone(
                        ids
                    );

                if (
                    Array.isArray(result)
                ) {
                    for (
                        const entry of result
                    ) {
                        const lid =
                            entry?.lid;

                        const phone =
                            entry?.pn ||
                            entry?.phone ||
                            entry?.phoneNumber;

                        if (
                            lid &&
                            phone
                        ) {
                            const normalized =
                                db.normalizePhone(
                                    phone
                                );

                            if (normalized) {
                                await db.saveLidPhone(
                                    String(lid)
                                        .replace(
                                            "@lid",
                                            ""
                                        ),
                                    normalized
                                );
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(
                    "LID map batch error:",
                    error.message
                );
            }
        }

        console.log(
            "WhatsApp LID/phone map refreshed."
        );

    } catch (error) {
        console.error(
            "Could not refresh LID map:",
            error.message
        );
    }
}

// ============================================================
// BUILD CONFIRMATION
// ============================================================

function buildConfirmation(order) {
    const lines = [];

    lines.push(
        `Order #${order.id}`
    );

    lines.push(
        `Delivered to: ${
            order.delivered_to || "Unknown"
        }`
    );

    lines.push("");

    for (
        const item of order.items || []
    ) {
        if (
            item.status === "ACCEPTED"
        ) {
            lines.push(
                `✅ ${item.item_name} — ${item.requested_quantity}`
            );
        } else {
            lines.push(
                `❌ ${item.item_name} — ${item.requested_quantity}`
            );

            if (
                item.rejection_reason
            ) {
                lines.push(
                    `   ${item.rejection_reason}`
                );
            }
        }
    }

    lines.push("");

    const accepted =
        Number(
            order.accepted_items
        );

    const rejected =
        Number(
            order.rejected_items
        );

    let resultText =
        "Order status: REJECTED";

    if (
        accepted > 0 &&
        rejected === 0
    ) {
        resultText =
            "Order status: SUCCESS";
    } else if (
        accepted > 0 &&
        rejected > 0
    ) {
        resultText =
            "Order status: PARTIAL";
    }

    lines.push(
        resultText
    );

    return lines.join("\n");
}

// ============================================================
// QUOTED REPLY
// ============================================================

async function sendConfirmationReply(
    message,
    confirmationText
) {
    console.log(
        "Sending quoted confirmation for:",
        getMessageId(message)
    );

    return await message.reply(
        confirmationText
    );
}

// ============================================================
// STOCK COMMAND
// ============================================================
//
// stock
//
// OR:
//
// stock
// bolt
// nut
//
// ============================================================

async function handleStockCommand(
    message,
    businessId = WHATSAPP_BUSINESS_ID
) {
    const lines =
        String(message.body || "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);

    if (
        lines.length === 0 ||
        lines[0].toLowerCase() !== "stock"
    ) {
        return false;
    }

    const requestedItems =
        lines.slice(1);

    try {
        const items =
            await db.getItems(businessId);

        if (
            !items ||
            items.length === 0
        ) {
            await message.reply(
                "📦 STOCK\n\nNo stock items found."
            );

            return true;
        }

        let reply =
            "📦 *CURRENT STOCK*\n\n";

        if (
            requestedItems.length === 0
        ) {
            for (
                const item of items
            ) {
                reply +=
                    `• *${item.name}*: ${item.current_stock} ${item.unit || ""}`.trimEnd() + "\n";
            }
        } else {
            for (
                const requestedName
                    of requestedItems
            ) {
                const item =
                    items.find(
                        stockItem =>
                            stockItem.name
                                .trim()
                                .toLowerCase() ===
                            requestedName
                                .trim()
                                .toLowerCase()
                    );

                if (item) {
                    reply +=
                        `• ${item.name}: ${item.current_stock}\n`;
                } else {
                    reply +=
                        `• ${requestedName}: ITEM NOT FOUND\n`;
                }
            }
        }

        await message.reply(
            reply.trim()
        );

        return true;

    } catch (error) {
        console.error(
            "Stock command error:",
            error
        );

        await message.reply(
            "❌ Unable to retrieve stock right now."
        );

        return true;
    }
}

// ============================================================
// CREATE A COMPLETELY NEW WHATSAPP CLIENT
// ============================================================

function createWhatsAppClient() {
    const generation =
        ++clientGeneration;

    const waClient =
        new Client({
            authStrategy:
                new LocalAuth({
                    clientId:
                        "delivery-system"
                }),

            puppeteer: {
                headless: true,

                 protocolTimeout: 120000,

                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-zygote"
                ]
            }
        });

    function isCurrentClient() {
        return (
            client === waClient &&
            generation === clientGeneration
        );
    }

    // ========================================================
    // QR
    // ========================================================

    waClient.on(
        "qr",
        async qr => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            console.log("");
            console.log(
                "=============================================="
            );
            console.log(
                "NEW WHATSAPP QR CODE"
            );
            console.log(
                "=============================================="
            );

            // Terminal backup.
            qrcodeTerminal.generate(
                qr,
                {
                    small: true
                }
            );

            try {
                const qrDataUrl =
                    await qrcode.toDataURL(
                        qr
                    );

                if (
                    !isCurrentClient()
                ) {
                    return;
                }

                writeStatus(
                    "QR",
                    "Scan this QR code with WhatsApp.",
                    qrDataUrl
                );

                console.log(
                    "Website QR saved."
                );

            } catch (error) {
                console.error(
                    "QR generation error:",
                    error.message
                );

                if (
                    isCurrentClient()
                ) {
                    writeStatus(
                        "QR",
                        "QR code generated. Open the dashboard.",
                        null
                    );
                }
            }
        }
    );

    // ========================================================
    // AUTHENTICATED
    // ========================================================

    waClient.on(
        "authenticated",
        () => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            console.log(
                "WhatsApp authenticated."
            );

            writeStatus(
                "AUTHENTICATED",
                "WhatsApp authentication successful. Loading...",
                null
            );
        }
    );

    // ========================================================
    // AUTH FAILURE
    // ========================================================

    waClient.on(
        "auth_failure",
        reason => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            console.error(
                "WhatsApp authentication failed:",
                reason
            );

            writeStatus(
                "DISCONNECTED",
                "Authentication failed. Preparing a new QR code...",
                null
            );

            scheduleReconnect(
                "AUTH_FAILURE"
            );
        }
    );

    // ========================================================
    // READY
    // ========================================================

    waClient.on(
        "ready",
        async () => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            clearReconnectTimer();

            console.log("");
            console.log(
                "=============================================="
            );
            console.log(
                "WHATSAPP DELIVERY SYSTEM READY"
            );
            console.log(
                "=============================================="
            );

            writeStatus(
                "READY",
                "WhatsApp is connected and ready.",
                null
            );

            try {
                await refreshLidPhoneMap(
                    waClient
                );
            } catch (error) {
                console.error(
                    "LID refresh error:",
                    error.message
                );
            }
        }
    );

    // ========================================================
    // DISCONNECTED
    // ========================================================

    waClient.on(
        "disconnected",
        reason => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            const reasonText =
                String(
                    reason ||
                    "UNKNOWN"
                );

            console.log("");
            console.log(
                "=============================================="
            );
            console.log(
                "WHATSAPP DISCONNECTED"
            );
            console.log(
                "Reason:",
                reasonText
            );
            console.log(
                "=============================================="
            );

            writeStatus(
                "DISCONNECTED",
                `WhatsApp disconnected (${reasonText}). Preparing QR code...`,
                null
            );

            // THIS IS THE IMPORTANT FIX.
            scheduleReconnect(
                reasonText
            );
        }
    );

    // ========================================================
    // CLIENT ERROR
    // ========================================================

    waClient.on(
        "error",
        error => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            console.error(
                "WhatsApp client error:"
            );

            console.error(
                error?.stack ||
                error?.message ||
                error
            );

            writeStatus(
                "ERROR",
                error?.message ||
                    "WhatsApp client error.",
                null
            );
        }
    );

    // ========================================================
    // MESSAGE
    // ========================================================

    waClient.on(
        "message",
        async message => {
            if (
                !isCurrentClient() ||
                shuttingDown
            ) {
                return;
            }

            try {
                console.log("");
                console.log(
                    "----------------------------------------------"
                );
                console.log(
                    "NEW WHATSAPP MESSAGE"
                );
                console.log(
                    "From:",
                    message.from
                );
                console.log(
                    "Message ID:",
                    getMessageId(message)
                );
                console.log(
                    "----------------------------------------------"
                );

                // ------------------------------------------------
                // NEVER PROCESS GROUPS
                // ------------------------------------------------

                if (
                    String(
                        message.from || ""
                    ).endsWith("@g.us")
                ) {
                    console.log(
                        "Group message ignored."
                    );

                    return;
                }

                // ------------------------------------------------
                // BODY
                // ------------------------------------------------

                const body =
                    typeof message.body ===
                    "string"
                        ? message.body.trim()
                        : "";

                if (!body) {
                    console.log(
                        "Empty message ignored."
                    );

                    return;
                }

                // ------------------------------------------------
                // MESSAGE ID
                // ------------------------------------------------

                const messageId =
                    getMessageId(
                        message
                    );

                if (!messageId) {
                    console.error(
                        "Could not determine WhatsApp message ID."
                    );

                    return;
                }

                if (inFlightMessageIds.has(messageId)) {
                    console.log("Concurrent duplicate event ignored:", messageId);
                    return;
                }

                inFlightMessageIds.add(messageId);

                // ------------------------------------------------
                // DUPLICATE PROTECTION
                // ------------------------------------------------

                if (
                    await db.isMessageProcessed(
                        messageId
                    )
                ) {
                    console.log(
                        "Duplicate message ignored:",
                        messageId
                    );

                    return;
                }

                // ------------------------------------------------
                // RESOLVE + AUTHORIZE SENDER
                // ------------------------------------------------

                const senderPhone =
                    await resolveRealPhoneNumber(
                        message,
                        waClient
                    );

                if (!senderPhone) {
                    console.log("Could not resolve real sender phone. Ignoring.");
                    return;
                }

                const sender =
                    await db.findSenderByPhone(
                        senderPhone,
                        WHATSAPP_BUSINESS_ID
                    );

                if (!sender) {
                    console.log("UNAUTHORIZED SENDER:", senderPhone);
                    return;
                }

                // ------------------------------------------------
                // STOCK COMMAND
                // ------------------------------------------------

                if (
                    await handleStockCommand(
                        message,
                        WHATSAPP_BUSINESS_ID
                    )
                ) {
                    return;
                }

                // ------------------------------------------------
                // PARSE ORDER
                // ------------------------------------------------

                const deliveries =
                    parseDeliveries(
                        body
                    );

                if (
                    deliveries.length === 0
                ) {
                    console.log(
                        "No valid order lines found."
                    );

                    return;
                }

                console.log("Resolved sender:", senderPhone);
                console.log("Authorized sender:", sender.name || sender.whatsapp_id);

                // ------------------------------------------------
                // DELIVERED TO
                // ------------------------------------------------

                const deliveredTo =
                    getDeliveredTo(
                        body
                    );

                // ------------------------------------------------
                // INDIA DATE / TIME
                // ------------------------------------------------

                const {
                    date,
                    time
                } =
                    getIndiaDateTime();

                // ------------------------------------------------
                // CREATE ONE ORDER
                // ------------------------------------------------

                console.log(
                    "Creating ONE order containing",
                    deliveries.length,
                    "items."
                );

                const order =
                    await db.createOrder({
                        date,
                        time,
                        deliveredTo,

                        senderId:
                            sender.id,

                        whatsappMessageId:
                            messageId,

                        whatsappFrom:
                            message.from,

                        body,

                        senderPhone,

                        businessId:
                            WHATSAPP_BUSINESS_ID,

                        items:
                            deliveries
                    });

                console.log(
                    `Order #${order.id} created.`
                );

                console.log(
                    "Initial status:",
                    order.status
                );

                // ------------------------------------------------
                // BUILD CONFIRMATION
                // ------------------------------------------------

                const confirmationText =
                    buildConfirmation(
                        order
                    );

                console.log("");
                console.log(
                    "Confirmation:"
                );
                console.log(
                    confirmationText
                );

                // ------------------------------------------------
                // CLAIM QUOTED REPLY
                // ------------------------------------------------

                const claimed = await db.claimConfirmation(order.id);

                if (!claimed) {
                    console.log("Confirmation already sent or being sent for Order #", order.id);
                    return;
                }

                // ------------------------------------------------
                // SEND QUOTED REPLY
                // ------------------------------------------------

                try {
                    const reply =
                        await sendConfirmationReply(
                            message,
                            confirmationText
                        );

                    const replyMessageId =
                        getMessageId(
                            reply
                        );

                    // ------------------------------------------------
                    // ONLY AFTER SUCCESSFUL SEND:
                    // PENDING -> SUCCESS/PARTIAL/REJECTED
                    // ------------------------------------------------

                    const updatedOrder =
                        await db.markConfirmationSent(
                            order.id,
                            replyMessageId
                        );

                    console.log("");
                    console.log(
                        `Order #${order.id} confirmation sent successfully.`
                    );

                    console.log(
                        "Final status:",
                        updatedOrder.status
                    );

                } catch (replyError) {
                    console.error("");
                    console.error(
                        `Could not send confirmation for Order #${order.id}:`
                    );

                    console.error(
                        replyError?.stack ||
                        replyError?.message ||
                        replyError
                    );

                    // Keep PENDING.
                    await db.markConfirmationPending(
                        order.id
                    );

                    console.log(
                        `Order #${order.id} remains PENDING.`
                    );
                }

            } catch (error) {
                console.error("");
                console.error(
                    "MESSAGE PROCESSING ERROR"
                );

                console.error(
                    error?.stack ||
                    error?.message ||
                    error
                );
            } finally {
                const currentMessageId = getMessageId(message);
                if (currentMessageId) {
                    inFlightMessageIds.delete(currentMessageId);
                }
            }
        }
    );

    return waClient;
}

// ============================================================
// DESTROY CURRENT CLIENT
// ============================================================
//
// We intentionally destroy the OLD Client and then create a
// completely NEW Client.
//
// This prevents:
//
// "The browser is already running for
// .../.wwebjs_auth/session-delivery-system"
//
// ============================================================

async function destroyCurrentClient() {
    const oldClient =
        client;

    client = null;

    if (!oldClient) {
        return;
    }

    console.log(
        "Destroying old WhatsApp client..."
    );

    try {
        await oldClient.destroy();

        console.log(
            "Old WhatsApp client destroyed."
        );

    } catch (error) {
        console.error(
            "Error destroying old WhatsApp client:",
            error?.message || error
        );
    }

    // Give Chromium/Puppeteer time to release
    // the LocalAuth browser profile.
    await sleep(5000);
}

// ============================================================
// START NEW CLIENT
// ============================================================

async function initializeNewClient(
    reason = "STARTUP"
) {
    if (shuttingDown) {
        return;
    }

    if (initializeInProgress) {
        console.log(
            "WhatsApp initialization already running."
        );

        return;
    }

    initializeInProgress = true;

    try {
        console.log("");
        console.log(
            "=============================================="
        );
        console.log(
            "CREATING NEW WHATSAPP CLIENT"
        );
        console.log(
            "Reason:",
            reason
        );
        console.log(
            "=============================================="
        );

        writeStatus(
            "CONNECTING",
            "Connecting to WhatsApp...",
            null
        );

        // Make sure there isn't an old client.
        if (client) {
            await destroyCurrentClient();
        }

        if (shuttingDown) {
            return;
        }

        // IMPORTANT:
        // Create a completely NEW Client.
        client =
            createWhatsAppClient();

        console.log(
            "New WhatsApp Client created."
        );
console.log(">>> CALLING client.initialize()");
        await client.initialize();
console.log(">>> client.initialize() RETURNED");
        console.log(
            "WhatsApp initialize() called successfully."
        );

    } catch (error) {
        console.error("");
        console.error(
            "WHATSAPP INITIALIZATION ERROR"
        );

        console.error(
            error?.stack ||
            error?.message ||
            error
        );

        // Do NOT immediately create another client
        // while the failed Chromium process might
        // still be closing.

        writeStatus(
            "DISCONNECTED",
            "WhatsApp could not connect. Retrying...",
            null
        );

        scheduleReconnect(
            "INITIALIZATION_ERROR"
        );

    } finally {
        initializeInProgress =
            false;
    }
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect(
    reason = "DISCONNECTED"
) {
    if (shuttingDown) {
        return;
    }

    if (reconnectInProgress) {
        return;
    }

    if (reconnectTimer) {
        return;
    }

    console.log(
        "Scheduling WhatsApp reconnect:",
        reason
    );

    reconnectTimer =
        setTimeout(
            async () => {
                reconnectTimer =
                    null;

                if (
                    shuttingDown ||
                    reconnectInProgress
                ) {
                    return;
                }

                reconnectInProgress =
                    true;

                try {
                    console.log("");
                    console.log(
                        "=============================================="
                    );
                    console.log(
                        "WHATSAPP RECONNECT START"
                    );
                    console.log(
                        "Reason:",
                        reason
                    );
                    console.log(
                        "=============================================="
                    );

                    writeStatus(
                        "CONNECTING",
                        "WhatsApp disconnected. Creating a new connection...",
                        null
                    );

                    // ------------------------------------------------
                    // Destroy OLD client.
                    // ------------------------------------------------

                    await destroyCurrentClient();

                    if (shuttingDown) {
                        return;
                    }

                    // ------------------------------------------------
                    // IMPORTANT:
                    // Create a completely NEW client.
                    // ------------------------------------------------

                    client =
                        createWhatsAppClient();

                    console.log(
                        "Fresh WhatsApp Client created for reconnect."
                    );

                    await client.initialize();

                    console.log(
                        "Fresh WhatsApp Client initialization started."
                    );

                } catch (error) {
                    console.error(
                        "Reconnect error:",
                        error?.stack ||
                        error?.message ||
                        error
                    );

                    writeStatus(
                        "DISCONNECTED",
                        "Reconnect failed. Retrying...",
                        null
                    );

                } finally {
                    reconnectInProgress =
                        false;

                    // If initialization failed before
                    // a disconnect event can be emitted,
                    // make sure another attempt is scheduled.
                    if (
                        !shuttingDown &&
                        !reconnectTimer &&
                        !initializeInProgress
                    ) {
                        reconnectTimer =
                            setTimeout(
                                () => {
                                    reconnectTimer =
                                        null;

                                    scheduleReconnect(
                                        "RECONNECT_RETRY"
                                    );
                                },
                                8000
                            );
                    }
                }
            },
            2000
        );
}

// ============================================================
// START
// ============================================================

console.log("");
console.log(
    "=============================================="
);
console.log(
    "WHATSAPP DELIVERY SYSTEM"
);
console.log(
    "=============================================="
);
console.log(
    "Starting WhatsApp..."
);
console.log(
    "=============================================="
);

initializeNewClient(
    "STARTUP"
);

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log("");
    console.log(
        `Received ${signal}. Shutting down WhatsApp...`
    );

    clearReconnectTimer();

    const oldClient =
        client;

    client = null;

    if (oldClient) {
        try {
            await oldClient.destroy();
        } catch (error) {
            console.error(
                "Shutdown destroy error:",
                error?.message || error
            );
        }
    }

    console.log(
        "WhatsApp client stopped."
    );

    process.exit(0);
}

process.on(
    "SIGINT",
    () => {
        shutdown("SIGINT");
    }
);

process.on(
    "SIGTERM",
    () => {
        shutdown("SIGTERM");
    }
);

// ============================================================
// UNHANDLED ERRORS
// ============================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled promise rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught exception:",
            error
        );
    }
);