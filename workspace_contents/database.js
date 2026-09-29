// ============================================================
// database.js
// SQLite database for WhatsApp Delivery System
// ONE WHATSAPP MESSAGE = ONE ORDER
// ============================================================

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// ============================================================
// DATABASE PATH
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "delivery.db");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

// ============================================================
// DATABASE
// ============================================================

const db = new sqlite3.Database(DB_PATH);

// ============================================================
// PROMISIFIED SQLITE HELPERS
// ============================================================

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) {
                reject(error);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows || []);
        });
    });
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
    await run(`PRAGMA foreign_keys = ON`);

    await run(`
        CREATE TABLE IF NOT EXISTS senders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT UNIQUE NOT NULL,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE COLLATE NOCASE NOT NULL,
            opening_stock REAL NOT NULL DEFAULT 0,
            current_stock REAL NOT NULL DEFAULT 0,
            minimum_stock REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            date TEXT,
            time TEXT,

            delivered_to TEXT,

            sender_id INTEGER,

            whatsapp_message_id TEXT UNIQUE NOT NULL,
            whatsapp_from TEXT,

            total_items INTEGER NOT NULL DEFAULT 0,
            accepted_items INTEGER NOT NULL DEFAULT 0,
            rejected_items INTEGER NOT NULL DEFAULT 0,

            status TEXT NOT NULL DEFAULT 'PENDING',

            confirmation_sent INTEGER NOT NULL DEFAULT 0,
            confirmation_message_id TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(sender_id)
                REFERENCES senders(id)
                ON DELETE SET NULL
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            order_id INTEGER NOT NULL,

            item_name TEXT NOT NULL,

            requested_quantity REAL NOT NULL,

            accepted_quantity REAL NOT NULL DEFAULT 0,

            rejected_quantity REAL NOT NULL DEFAULT 0,

            status TEXT NOT NULL,

            rejection_reason TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(order_id)
                REFERENCES orders(id)
                ON DELETE CASCADE
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS stock_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            item_id INTEGER NOT NULL,

            type TEXT NOT NULL
                CHECK(type IN ('IN', 'OUT')),

            quantity REAL NOT NULL,

            reason TEXT,

            order_id INTEGER,

            order_item_id INTEGER,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(item_id)
                REFERENCES items(id)
                ON DELETE CASCADE,

            FOREIGN KEY(order_id)
                REFERENCES orders(id)
                ON DELETE SET NULL,

            FOREIGN KEY(order_item_id)
                REFERENCES order_items(id)
                ON DELETE SET NULL
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            message_id TEXT UNIQUE NOT NULL,

            whatsapp_from TEXT,

            sender_phone TEXT,

            body TEXT,

            processed_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS whatsapp_lid_map (
            lid TEXT PRIMARY KEY,

            phone TEXT NOT NULL,

            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

initializeDatabase()
    .then(() => {
        console.log("SQLite database initialized.");
    })
    .catch((error) => {
        console.error(
            "Database initialization failed:",
            error
        );
    });

// ============================================================
// PHONE NORMALIZATION
// ============================================================

function normalizePhone(phone) {
    let value = String(phone || "").trim();

    value = value.replace(/\D/g, "");

    if (!value) {
        return "";
    }

    return value;
}

// ============================================================
// SENDERS
// ============================================================

async function findSenderByPhone(phone) {
    const normalized = normalizePhone(phone);

    return get(
        `
        SELECT *
        FROM senders
        WHERE whatsapp_id = ?
        LIMIT 1
        `,
        [normalized]
    );
}

async function isSenderAllowed(phone) {
    const sender = await findSenderByPhone(phone);

    return !!sender;
}

async function addSender(phone, name = "") {
    const normalized = normalizePhone(phone);

    if (!normalized) {
        throw new Error(
            "Invalid WhatsApp phone number."
        );
    }

    const result = await run(
        `
        INSERT INTO senders
        (
            whatsapp_id,
            name
        )
        VALUES (?, ?)
        `,
        [
            normalized,
            String(name || "").trim()
        ]
    );

    return get(
        `
        SELECT *
        FROM senders
        WHERE id = ?
        `,
        [result.lastID]
    );
}

async function removeSender(id) {
    return run(
        `
        DELETE FROM senders
        WHERE id = ?
        `,
        [id]
    );
}

async function getSenders() {
    return all(
        `
        SELECT *
        FROM senders
        ORDER BY id DESC
        `
    );
}

// ============================================================
// LID ↔ PHONE
// ============================================================

async function getPhoneFromLid(lid) {
    const row = await get(
        `
        SELECT phone
        FROM whatsapp_lid_map
        WHERE lid = ?
        LIMIT 1
        `,
        [lid]
    );

    return row?.phone || null;
}

async function saveLidPhone(lid, phone) {
    return run(
        `
        INSERT INTO whatsapp_lid_map
        (
            lid,
            phone,
            updated_at
        )
        VALUES (?, ?, CURRENT_TIMESTAMP)

        ON CONFLICT(lid)
        DO UPDATE SET
            phone = excluded.phone,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
            String(lid),
            normalizePhone(phone)
        ]
    );
}

// ============================================================
// ITEMS
// ============================================================

async function findItemByName(name) {
    return get(
        `
        SELECT *
        FROM items
        WHERE name = ?
        COLLATE NOCASE
        LIMIT 1
        `,
        [String(name || "").trim()]
    );
}

async function addItem(
    name,
    openingStock = 0,
    minimumStock = 0
) {
    const cleanName = String(name || "").trim();

    const opening = Number(openingStock);
    const minimum = Number(minimumStock);

    if (!cleanName) {
        throw new Error(
            "Item name is required."
        );
    }

    if (!Number.isFinite(opening) || opening < 0) {
        throw new Error(
            "Opening stock must be non-negative."
        );
    }

    if (!Number.isFinite(minimum) || minimum < 0) {
        throw new Error(
            "Minimum stock must be non-negative."
        );
    }

    const result = await run(
        `
        INSERT INTO items
        (
            name,
            opening_stock,
            current_stock,
            minimum_stock
        )
        VALUES (?, ?, ?, ?)
        `,
        [
            cleanName,
            opening,
            opening,
            minimum
        ]
    );

    return get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [result.lastID]
    );
}

// ============================================================
// MANUAL STOCK ADDITION
// ============================================================

async function updateStock(
    itemId,
    quantity,
    reason = "Manual stock addition"
) {
    const amount = Number(quantity);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
            "Stock quantity must be greater than zero."
        );
    }

    const item = await get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [itemId]
    );

    if (!item) {
        throw new Error(
            "Item not found."
        );
    }

    await run(
        `
        UPDATE items
        SET current_stock =
            current_stock + ?
        WHERE id = ?
        `,
        [
            amount,
            itemId
        ]
    );

    await run(
        `
        INSERT INTO stock_transactions
        (
            item_id,
            type,
            quantity,
            reason
        )
        VALUES (?, 'IN', ?, ?)
        `,
        [
            itemId,
            amount,
            reason
        ]
    );

    return get(
        `
        SELECT *
        FROM items
        WHERE id = ?
        `,
        [itemId]
    );
}

async function getItems() {
    return all(
        `
        SELECT
            *,
            CASE
                WHEN current_stock <= minimum_stock
                THEN 1
                ELSE 0
            END AS low_stock
        FROM items
        ORDER BY name COLLATE NOCASE ASC
        `
    );
}

async function deleteItem(id) {
    return run(
        `
        DELETE FROM items
        WHERE id = ?
        `,
        [id]
    );
}

// ============================================================
// MESSAGE DUPLICATE PROTECTION
// ============================================================

async function isMessageProcessed(messageId) {
    const row = await get(
        `
        SELECT *
        FROM processed_messages
        WHERE message_id = ?
        LIMIT 1
        `,
        [messageId]
    );

    return !!row;
}

async function saveProcessedMessage(
    messageId,
    whatsappFrom = "",
    senderPhone = "",
    body = ""
) {
    return run(
        `
        INSERT OR IGNORE INTO processed_messages
        (
            message_id,
            whatsapp_from,
            sender_phone,
            body
        )
        VALUES (?, ?, ?, ?)
        `,
        [
            messageId,
            whatsappFrom,
            senderPhone,
            body
        ]
    );
}

// ============================================================
// ORDER STATUS CALCULATOR
// ============================================================

function calculateFinalStatus(
    acceptedItems,
    rejectedItems
) {
    if (
        acceptedItems > 0 &&
        rejectedItems === 0
    ) {
        return "SUCCESS";
    }

    if (
        acceptedItems > 0 &&
        rejectedItems > 0
    ) {
        return "PARTIAL";
    }

    return "REJECTED";
}

// ============================================================
// CREATE ONE COMPLETE ORDER
// ============================================================
//
// IMPORTANT:
// One WhatsApp message creates exactly ONE orders row.
//
// Example:
// rahul
// 10 bolt
// 5 nut
// 20 washer
//
// = ONE order
// + THREE order_items
//
// ============================================================

async function createOrder({
    date,
    time,
    deliveredTo,
    senderId,
    whatsappMessageId,
    whatsappFrom,
    body = "",
    senderPhone = "",
    items
}) {
    if (!whatsappMessageId) {
        throw new Error(
            "WhatsApp message ID is required."
        );
    }

    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {
        throw new Error(
            "Order must contain at least one item."
        );
    }

    // --------------------------------------------------------
    // Duplicate protection
    // --------------------------------------------------------

    const existing = await get(
        `
        SELECT *
        FROM orders
        WHERE whatsapp_message_id = ?
        LIMIT 1
        `,
        [whatsappMessageId]
    );

    if (existing) {
        return getOrderById(existing.id);
    }

    // --------------------------------------------------------
    // BEGIN TRANSACTION
    // --------------------------------------------------------

    await run(
        `BEGIN IMMEDIATE TRANSACTION`
    );

    try {
        // Recheck after transaction begins.
        const duplicate = await get(
            `
            SELECT *
            FROM orders
            WHERE whatsapp_message_id = ?
            LIMIT 1
            `,
            [whatsappMessageId]
        );

        if (duplicate) {
            await run(`ROLLBACK`);

            return getOrderById(
                duplicate.id
            );
        }

        // ----------------------------------------------------
        // ONE orders row
        // ----------------------------------------------------

        const orderResult = await run(
            `
            INSERT INTO orders
            (
                date,
                time,
                delivered_to,
                sender_id,
                whatsapp_message_id,
                whatsapp_from,
                total_items,
                accepted_items,
                rejected_items,
                status,
                confirmation_sent
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', 0)
            `,
            [
                date || "",
                time || "",
                deliveredTo || "Unknown",
                senderId || null,
                whatsappMessageId,
                whatsappFrom || "",
                items.length
            ]
        );

        const orderId =
            orderResult.lastID;

        let acceptedCount = 0;
        let rejectedCount = 0;

        // ----------------------------------------------------
        // PROCESS EACH ITEM
        // ----------------------------------------------------

        for (const inputItem of items) {
            const itemName =
                String(
                    inputItem.item ??
                    inputItem.item_name ??
                    inputItem.name ??
                    ""
                ).trim();

            const requestedQuantity =
                Number(
                    inputItem.quantity ??
                    inputItem.requested_quantity
                );

            // ----------------------------------------------
            // Invalid item
            // ----------------------------------------------

            if (
                !itemName ||
                !Number.isFinite(
                    requestedQuantity
                ) ||
                requestedQuantity <= 0
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName || "UNKNOWN",
                        Number.isFinite(
                            requestedQuantity
                        )
                            ? requestedQuantity
                            : 0,
                        Number.isFinite(
                            requestedQuantity
                        )
                            ? requestedQuantity
                            : 0,
                        "INVALID ITEM OR QUANTITY"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // Find existing stock item
            // ----------------------------------------------

            const stockItem =
                await get(
                    `
                    SELECT *
                    FROM items
                    WHERE name = ?
                    COLLATE NOCASE
                    LIMIT 1
                    `,
                    [itemName]
                );

            // ----------------------------------------------
            // Item does not exist
            // ----------------------------------------------

            if (!stockItem) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "ITEM NOT IN STOCK"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // No stock
            // ----------------------------------------------

            if (
                Number(
                    stockItem.current_stock
                ) <= 0
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "STOCK EXHAUSTED"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // Insufficient stock
            //
            // NEVER partially fulfill.
            // ----------------------------------------------

            if (
                Number(
                    stockItem.current_stock
                ) < requestedQuantity
            ) {
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, 0, ?, 'REJECTED', ?)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity,
                        "INSUFFICIENT STOCK"
                    ]
                );

                rejectedCount++;

                continue;
            }

            // ----------------------------------------------
            // ACCEPT ITEM
            // ----------------------------------------------

            const orderItemResult =
                await run(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        item_name,
                        requested_quantity,
                        accepted_quantity,
                        rejected_quantity,
                        status,
                        rejection_reason
                    )
                    VALUES (?, ?, ?, ?, 0, 'ACCEPTED', NULL)
                    `,
                    [
                        orderId,
                        itemName,
                        requestedQuantity,
                        requestedQuantity
                    ]
                );

            const orderItemId =
                orderItemResult.lastID;

            // Deduct stock.
            await run(
                `
                UPDATE items
                SET current_stock =
                    current_stock - ?
                WHERE id = ?
                `,
                [
                    requestedQuantity,
                    stockItem.id
                ]
            );

            // Record stock movement.
            await run(
                `
                INSERT INTO stock_transactions
                (
                    item_id,
                    type,
                    quantity,
                    reason,
                    order_id,
                    order_item_id
                )
                VALUES (?, 'OUT', ?, ?, ?, ?)
                `,
                [
                    stockItem.id,
                    requestedQuantity,
                    `WhatsApp Order #${orderId}`,
                    orderId,
                    orderItemId
                ]
            );

            acceptedCount++;
        }

        // ----------------------------------------------------
        // UPDATE COUNTS
        //
        // Status intentionally remains PENDING.
        // It changes only after WhatsApp confirmation succeeds.
        // ----------------------------------------------------

        await run(
            `
            UPDATE orders
            SET
                accepted_items = ?,
                rejected_items = ?,
                status = 'PENDING'
            WHERE id = ?
            `,
            [
                acceptedCount,
                rejectedCount,
                orderId
            ]
        );

        // ----------------------------------------------------
        // Save processed message atomically.
        // ----------------------------------------------------

        await run(
            `
            INSERT OR IGNORE INTO processed_messages
            (
                message_id,
                whatsapp_from,
                sender_phone,
                body
            )
            VALUES (?, ?, ?, ?)
            `,
            [
                whatsappMessageId,
                whatsappFrom || "",
                senderPhone || "",
                body || ""
            ]
        );

        await run(
            `COMMIT`
        );

        return getOrderById(orderId);
    } catch (error) {
        try {
            await run(`ROLLBACK`);
        } catch (_) {}

        throw error;
    }
}

// ============================================================
// GET COMPLETE ORDER
// ============================================================

async function getOrderById(orderId) {
    const order = await get(
        `
        SELECT
            o.*,
            s.name AS sender_name,
            s.whatsapp_id AS sender_phone
        FROM orders o
        LEFT JOIN senders s
            ON s.id = o.sender_id
        WHERE o.id = ?
        LIMIT 1
        `,
        [orderId]
    );

    if (!order) {
        return null;
    }

    const items = await all(
        `
        SELECT *
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [orderId]
    );

    return {
        ...order,
        confirmation_sent:
            Boolean(order.confirmation_sent),
        items
    };
}

// ============================================================
// GET ALL ORDERS
// ============================================================

async function getOrders() {
    const orders = await all(
        `
        SELECT
            o.*,
            s.name AS sender_name,
            s.whatsapp_id AS sender_phone
        FROM orders o
        LEFT JOIN senders s
            ON s.id = o.sender_id
        ORDER BY
            o.id DESC
        `
    );

    return orders.map((order) => ({
        ...order,
        confirmation_sent:
            Boolean(order.confirmation_sent)
    }));
}

// ============================================================
// CONFIRMATION SUCCESS
// ============================================================

async function markConfirmationSent(
    orderId,
    confirmationMessageId = ""
) {
    const order = await get(
        `
        SELECT *
        FROM orders
        WHERE id = ?
        LIMIT 1
        `,
        [orderId]
    );

    if (!order) {
        throw new Error(
            "Order not found."
        );
    }

    const finalStatus =
        calculateFinalStatus(
            Number(order.accepted_items),
            Number(order.rejected_items)
        );

    await run(
        `
        UPDATE orders
        SET
            confirmation_sent = 1,
            confirmation_message_id = ?,
            status = ?
        WHERE id = ?
        `,
        [
            confirmationMessageId || "",
            finalStatus,
            orderId
        ]
    );

    return getOrderById(orderId);
}

// ============================================================
// CONFIRMATION FAILED
// ============================================================

async function markConfirmationPending(
    orderId
) {
    await run(
        `
        UPDATE orders
        SET
            confirmation_sent = 0,
            status = 'PENDING'
        WHERE id = ?
        `,
        [orderId]
    );

    return getOrderById(orderId);
}

// ============================================================
// STOCK TRANSACTIONS
// ============================================================

async function getStockTransactions() {
    return all(
        `
        SELECT
            st.*,
            i.name AS item_name
        FROM stock_transactions st
        LEFT JOIN items i
            ON i.id = st.item_id
        ORDER BY
            st.id DESC
        `
    );
}

// ============================================================
// CLOSE DATABASE
// ============================================================

function closeDatabase() {
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    db,

    normalizePhone,

    run,
    get,
    all,

    findSenderByPhone,
    isSenderAllowed,

    addSender,
    removeSender,
    getSenders,

    getPhoneFromLid,
    saveLidPhone,

    findItemByName,
    addItem,
    updateStock,
    getItems,
    deleteItem,

    isMessageProcessed,
    saveProcessedMessage,

    createOrder,
    getOrderById,
    getOrders,

    markConfirmationSent,
    markConfirmationPending,

    getStockTransactions,

    closeDatabase
};