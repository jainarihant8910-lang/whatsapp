// ============================================================
// server.js
// Delivery Management Website
// ============================================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const db = require("./database");

const app = express();

const PORT =
    Number(process.env.PORT) || 3000;

const PUBLIC_DIR =
    path.join(
        __dirname,
        "public"
    );

const STATUS_FILE =
    path.join(
        __dirname,
        "data",
        "whatsapp-status.json"
    );

// ============================================================
// EXPRESS
// ============================================================

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// Static website
app.use(
    express.static(
        PUBLIC_DIR
    )
);

// ============================================================
// HELPERS
// ============================================================

function clean(value) {
    return String(
        value ?? ""
    ).trim();
}

function readWhatsAppStatus() {
    try {
        if (
            !fs.existsSync(
                STATUS_FILE
            )
        ) {
            return {
                status: "DISCONNECTED",
                message:
                    "WhatsApp is not connected.",
                qr: null
            };
        }

        return JSON.parse(
            fs.readFileSync(
                STATUS_FILE,
                "utf8"
            )
        );
    } catch (error) {
        return {
            status: "ERROR",
            message:
                "Could not read WhatsApp status.",
            qr: null
        };
    }
}

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/api/health",
    async (req, res) => {
        try {
            await db.get(
                "SELECT 1 AS ok"
            );

            res.json({
                success: true,
                server: true,
                database: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                server: true,
                database: false,
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// DASHBOARD
// ============================================================

app.get(
    "/api/dashboard",
    async (req, res) => {
        try {
            const totalOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                `);

            const todayOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE date =
                        date('now', 'localtime')
                `);

            const pendingOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'PENDING'
                `);

            const successOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'SUCCESS'
                `);

            const partialOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'PARTIAL'
                `);

            const rejectedOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'REJECTED'
                `);

            const errorOrders =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM orders
                    WHERE status = 'ERROR'
                `);

            const totalStockItems =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM items
                `);

            const lowStockItems =
                await db.get(`
                    SELECT COUNT(*) AS count
                    FROM items
                    WHERE current_stock <= minimum_stock
                `);

            res.json({
                success: true,

                totalOrders:
                    totalOrders?.count || 0,

                todayOrders:
                    todayOrders?.count || 0,

                pendingOrders:
                    pendingOrders?.count || 0,

                successOrders:
                    successOrders?.count || 0,

                partialOrders:
                    partialOrders?.count || 0,

                rejectedOrders:
                    rejectedOrders?.count || 0,

                errorOrders:
                    errorOrders?.count || 0,

                totalStockItems:
                    totalStockItems?.count || 0,

                lowStockItems:
                    lowStockItems?.count || 0
            });
        } catch (error) {
            console.error(
                "Dashboard error:",
                error
            );

            res.status(500).json({
                error:
                    "Failed to load dashboard."
            });
        }
    }
);

// ============================================================
// ORDERS
// ============================================================

app.get(
    "/api/orders",
    async (req, res) => {
        try {
            const orders =
                await db.getOrders();

            res.json({
                success: true,
                orders
            });
        } catch (error) {
            console.error(
                "Orders error:",
                error
            );

            res.status(500).json({
                error:
                    "Failed to load orders."
            });
        }
    }
);

// Single complete order
app.get(
    "/api/orders/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid order ID."
                });
            }

            const order =
                await db.getOrderById(
                    id
                );

            if (!order) {
                return res.status(404).json({
                    error:
                        "Order not found."
                });
            }

            res.json({
                success: true,
                order
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load order."
            });
        }
    }
);

// ============================================================
// DELIVERY API
//
// This endpoint exists so your website does NOT receive 404
// when it accesses /api/whatsapp/delivery.
//
// New index.js writes directly to SQLite, but this route is
// retained for compatibility.
// ============================================================

app.get(
    "/api/whatsapp/delivery",
    async (req, res) => {
        try {
            const orders =
                await db.getOrders();

            res.json({
                success: true,
                orders
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load delivery records."
            });
        }
    }
);

// ============================================================
// STOCK
// ============================================================

app.get(
    "/api/items",
    async (req, res) => {
        try {
            const items =
                await db.getItems();

            res.json({
                success: true,
                items
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load stock."
            });
        }
    }
);

// Add stock item
app.post(
    "/api/items",
    async (req, res) => {
        try {
            const name =
                clean(req.body.name);

            const opening =
                Number(
                    req.body.opening_stock ??
                    req.body.openingStock ??
                    0
                );

            const minimum =
                Number(
                    req.body.minimum_stock ??
                    req.body.minimumStock ??
                    0
                );

            if (!name) {
                return res.status(400).json({
                    error:
                        "Item name is required."
                });
            }

            if (
                !Number.isFinite(opening) ||
                opening < 0
            ) {
                return res.status(400).json({
                    error:
                        "Opening stock must be non-negative."
                });
            }

            if (
                !Number.isFinite(minimum) ||
                minimum < 0
            ) {
                return res.status(400).json({
                    error:
                        "Minimum stock must be non-negative."
                });
            }

            const existing =
                await db.findItemByName(
                    name
                );

            if (existing) {
                return res.status(409).json({
                    error:
                        "Item already exists."
                });
            }

            const item =
                await db.addItem(
                    name,
                    opening,
                    minimum
                );

            res.status(201).json({
                success: true,
                item
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to add stock item."
            });
        }
    }
);

// Add stock
app.post(
    "/api/items/:id/stock",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            const quantity =
                Number(
                    req.body.quantity
                );

            const reason =
                clean(
                    req.body.reason
                ) ||
                "Manual stock addition";

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid item ID."
                });
            }

            if (
                !Number.isFinite(quantity) ||
                quantity <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Quantity must be greater than zero."
                });
            }

            const item =
                await db.get(
                    `
                    SELECT *
                    FROM items
                    WHERE id = ?
                    `,
                    [id]
                );

            if (!item) {
                return res.status(404).json({
                    error:
                        "Item not found."
                });
            }

            const updated =
                await db.updateStock(
                    id,
                    quantity,
                    reason
                );

            res.json({
                success: true,
                item: updated
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to update stock."
            });
        }
    }
);

// Delete stock item
app.delete(
    "/api/items/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    error:
                        "Invalid item ID."
                });
            }

            await db.deleteItem(
                id
            );

            res.json({
                success: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to delete item."
            });
        }
    }
);

// ============================================================
// TRANSACTIONS
// ============================================================

app.get(
    "/api/transactions",
    async (req, res) => {
        try {
            const transactions =
                await db.getStockTransactions();

            res.json({
                success: true,
                transactions
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load transactions."
            });
        }
    }
);

// ============================================================
// SENDERS
// ============================================================

app.get(
    "/api/senders",
    async (req, res) => {
        try {
            const senders =
                await db.getSenders();

            res.json({
                success: true,
                senders
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to load senders."
            });
        }
    }
);

app.post(
    "/api/senders",
    async (req, res) => {
        try {
            const name =
                clean(req.body.name);

            const phone =
                db.normalizePhone(
                    req.body.phone ??
                    req.body.whatsapp_id
                );

            if (!phone) {
                return res.status(400).json({
                    error:
                        "WhatsApp phone number is required."
                });
            }

            const existing =
                await db.findSenderByPhone(
                    phone
                );

            if (existing) {
                return res.status(409).json({
                    error:
                        "This number is already allowed."
                });
            }

            const sender =
                await db.addSender(
                    phone,
                    name
                );

            res.status(201).json({
                success: true,
                sender
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to add sender."
            });
        }
    }
);

app.delete(
    "/api/senders/:id",
    async (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            await db.removeSender(
                id
            );

            res.json({
                success: true
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                error:
                    "Failed to remove sender."
            });
        }
    }
);

// ============================================================
// WHATSAPP STATUS
// ============================================================

app.get(
    "/api/whatsapp/status",
    (req, res) => {
        res.json(
            readWhatsAppStatus()
        );
    }
);

app.get(
    "/api/whatsapp/qr",
    (req, res) => {
        const status =
            readWhatsAppStatus();

        res.json({
            success: true,
            qr:
                status.qr || null
        });
    }
);

// ============================================================
// SPA FALLBACK
//
// Express 5 syntax.
// ============================================================

app.get(
    "/{*splat}",
    (req, res) => {
        const indexPath =
            path.join(
                PUBLIC_DIR,
                "index.html"
            );

        if (
            !fs.existsSync(indexPath)
        ) {
            return res.status(404).send(
                `
                <h1>404</h1>
                <p>public/index.html was not found.</p>
                `
            );
        }

        res.sendFile(
            indexPath
        );
    }
);

// ============================================================
// START
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log(
            "=========================================="
        );
        console.log(
            " DELIVERY MANAGEMENT SYSTEM"
        );
        console.log(
            "=========================================="
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            `Dashboard: http://localhost:${PORT}`
        );
        console.log(
            "One WhatsApp message = one order"
        );
        console.log(
            "SQLite database connected"
        );
        console.log(
            "=========================================="
        );
        console.log("");
    }
);