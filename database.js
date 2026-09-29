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
// PURCHASE / PRODUCT FIELDS MIGRATION
// ============================================================

async function addColumnIfMissing(
    tableName,
    columnName,
    columnDefinition
) {
    const columns = await all(
        `PRAGMA table_info(${tableName})`
    );

    const exists = columns.some(
        column => column.name === columnName
    );

    if (!exists) {
        await run(
            `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`
        );

        console.log(
            `Added ${tableName}.${columnName}`
        );
    }
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
        // ========================================================
    // ITEM FIELD MIGRATIONS
    // ========================================================

   

  
// ============================================================
// PURCHASE / PRODUCT FIELDS MIGRATION
// ============================================================


await addColumnIfMissing(
    "items",
    "purchase_price",
    "REAL NOT NULL DEFAULT 0"
);

await addColumnIfMissing(
    "items",
    "gst_rate",
    "REAL NOT NULL DEFAULT 0"
);

await addColumnIfMissing(
    "items",
    "unit",
    "TEXT DEFAULT 'PCS'"
);

await addColumnIfMissing(
    "items",
    "hsn_code",
    "TEXT DEFAULT ''"
);
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
// ============================================================
// PURCHASE BILLS
// ============================================================

await run(`
    CREATE TABLE IF NOT EXISTS purchase_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        original_filename TEXT NOT NULL,

        file_type TEXT NOT NULL,

        file_hash TEXT UNIQUE NOT NULL,

        supplier_name TEXT,

        invoice_number TEXT,

        invoice_date TEXT,

        raw_text TEXT,

        status TEXT NOT NULL DEFAULT 'REVIEW',

        created_at TEXT DEFAULT CURRENT_TIMESTAMP,

        confirmed_at TEXT
    )
`);

// ============================================================
// PURCHASE BILL ITEMS
// ============================================================

await run(`
    CREATE TABLE IF NOT EXISTS purchase_bill_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        purchase_bill_id INTEGER NOT NULL,

        extracted_name TEXT NOT NULL,

        matched_item_id INTEGER,

        quantity REAL NOT NULL DEFAULT 0,

        unit TEXT DEFAULT 'PCS',

        purchase_price REAL NOT NULL DEFAULT 0,

        gst_rate REAL NOT NULL DEFAULT 0,

        hsn_code TEXT DEFAULT '',

        is_new_item INTEGER NOT NULL DEFAULT 0,

        created_at TEXT DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY(purchase_bill_id)
            REFERENCES purchase_bills(id)
            ON DELETE CASCADE,

        FOREIGN KEY(matched_item_id)
            REFERENCES items(id)
            ON DELETE SET NULL
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

// ============================================================
// PURCHASE BILLS
// ============================================================

async function createPurchaseBill({
    originalFilename,
    fileType,
    fileHash,
    supplierName = "",
    invoiceNumber = "",
    invoiceDate = "",
    rawText = ""
}) {
    const existing = await get(
        `
        SELECT *
        FROM purchase_bills
        WHERE file_hash = ?
        LIMIT 1
        `,
        [fileHash]
    );

    if (existing) {
        return {
            duplicate: true,
            bill: existing
        };
    }

    const result = await run(
        `
        INSERT INTO purchase_bills
        (
            original_filename,
            file_type,
            file_hash,
            supplier_name,
            invoice_number,
            invoice_date,
            raw_text,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'REVIEW')
        `,
        [
            originalFilename,
            fileType,
            fileHash,
            supplierName,
            invoiceNumber,
            invoiceDate,
            rawText
        ]
    );

    return {
        duplicate: false,
        bill: await get(
            `
            SELECT *
            FROM purchase_bills
            WHERE id = ?
            `,
            [result.lastID]
        )
    };
}


// ============================================================
// PURCHASE BILL ITEMS
// ============================================================

async function addPurchaseBillItem({
    purchaseBillId,
    extractedName,
    matchedItemId = null,
    quantity,
    unit = "PCS",
    purchasePrice = 0,
    gstRate = 0,
    hsnCode = "",
    isNewItem = false
}) {
    const result = await run(
        `
        INSERT INTO purchase_bill_items
        (
            purchase_bill_id,
            extracted_name,
            matched_item_id,
            quantity,
            unit,
            purchase_price,
            gst_rate,
            hsn_code,
            is_new_item
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            purchaseBillId,
            extractedName,
            matchedItemId,
            quantity,
            unit,
            purchasePrice,
            gstRate,
            hsnCode,
            isNewItem ? 1 : 0
        ]
    );

    return get(
        `
        SELECT *
        FROM purchase_bill_items
        WHERE id = ?
        `,
        [result.lastID]
    );
}


// ============================================================
// GET PURCHASE BILL
// ============================================================

async function getPurchaseBillById(id) {
    const bill = await get(
        `
        SELECT *
        FROM purchase_bills
        WHERE id = ?
        `,
        [id]
    );

    if (!bill) {
        return null;
    }

    const items = await all(
        `
        SELECT
            pbi.*,
            i.name AS matched_item_name,
            i.current_stock AS current_stock
        FROM purchase_bill_items pbi
        LEFT JOIN items i
            ON i.id = pbi.matched_item_id
        WHERE pbi.purchase_bill_id = ?
        ORDER BY pbi.id ASC
        `,
        [id]
    );

    return {
        bill,
        items
    };
}


// ============================================================
// CONFIRM PURCHASE BILL
// ============================================================

async function confirmPurchaseBill(
    purchaseBillId,
    confirmedItems
) {
    if (
        !Number.isInteger(
            Number(purchaseBillId)
        )
    ) {
        throw new Error(
            "Invalid purchase bill ID."
        );
    }

    if (
        !Array.isArray(confirmedItems) ||
        confirmedItems.length === 0
    ) {
        throw new Error(
            "No purchase items to confirm."
        );
    }

    const bill = await get(
        `
        SELECT *
        FROM purchase_bills
        WHERE id = ?
        `,
        [purchaseBillId]
    );

    if (!bill) {
        throw new Error(
            "Purchase bill not found."
        );
    }

    if (bill.status === "CONFIRMED") {
        throw new Error(
            "This purchase bill has already been confirmed."
        );
    }

    await run("BEGIN TRANSACTION");

    try {
        for (const entry of confirmedItems) {
            const name = String(
                entry.name ||
                entry.extracted_name ||
                ""
            ).trim();

            const quantity = Number(
                entry.quantity
            );

            const unit =
                String(
                    entry.unit || "PCS"
                ).trim();

            const purchasePrice = Number(
                entry.purchase_price || 0
            );

            const gstRate = Number(
                entry.gst_rate || 0
            );

            const hsnCode =
                String(
                    entry.hsn_code || ""
                ).trim();

            if (!name) {
                throw new Error(
                    "Every purchase item must have a name."
                );
            }

            if (
                !Number.isFinite(quantity) ||
                quantity <= 0
            ) {
                throw new Error(
                    `Invalid quantity for ${name}.`
                );
            }

            if (
                !Number.isFinite(purchasePrice) ||
                purchasePrice < 0
            ) {
                throw new Error(
                    `Invalid purchase price for ${name}.`
                );
            }

            if (
                !Number.isFinite(gstRate) ||
                gstRate < 0 ||
                gstRate > 100
            ) {
                throw new Error(
                    `Invalid GST rate for ${name}.`
                );
            }

            let item = null;

            if (entry.item_id) {
                item = await get(
                    `
                    SELECT *
                    FROM items
                    WHERE id = ?
                    `,
                    [Number(entry.item_id)]
                );
            }

            if (!item) {
                item = await get(
                    `
                    SELECT *
                    FROM items
                    WHERE name = ?
                    COLLATE NOCASE
                    LIMIT 1
                    `,
                    [name]
                );
            }

            // ------------------------------------------------
            // EXISTING ITEM
            // ------------------------------------------------

            if (item) {
                await run(
                    `
                    UPDATE items
                    SET
                        current_stock =
                            current_stock + ?,
                        purchase_price = ?,
                        gst_rate = ?,
                        unit = ?,
                        hsn_code = ?
                    WHERE id = ?
                    `,
                    [
                        quantity,
                        purchasePrice,
                        gstRate,
                        unit,
                        hsnCode,
                        item.id
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
                        item.id,
                        quantity,
                        `Purchase bill #${purchaseBillId}`
                    ]
                );
            }

            // ------------------------------------------------
            // NEW ITEM
            // ------------------------------------------------

            else {
                const result = await run(
                    `
                    INSERT INTO items
                    (
                        name,
                        opening_stock,
                        current_stock,
                        minimum_stock,
                        purchase_price,
                        gst_rate,
                        unit,
                        hsn_code
                    )
                    VALUES (?, 0, ?, 0, ?, ?, ?, ?)
                    `,
                    [
                        name,
                        quantity,
                        purchasePrice,
                        gstRate,
                        unit,
                        hsnCode
                    ]
                );

                const newItemId =
                    result.lastID;

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
                        newItemId,
                        quantity,
                        `New product from purchase bill #${purchaseBillId}`
                    ]
                );
            }
        }

        await run(
            `
            UPDATE purchase_bills
            SET
                status = 'CONFIRMED',
                confirmed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [purchaseBillId]
        );

        await run(
            "COMMIT"
        );

        return getPurchaseBillById(
            purchaseBillId
        );
    } catch (error) {
        await run(
            "ROLLBACK"
        );

        throw error;
    }
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
    createPurchaseBill,
    addPurchaseBillItem,
    getPurchaseBillById,
    confirmPurchaseBill,
    closeDatabase
}};