const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(
    __dirname,
    "data",
    "delivery.db"
);

const db = new sqlite3.Database(dbPath);

function run(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, function (error) {
            if (error) {
                reject(error);
            } else {
                resolve(this);
            }
        });
    });
}

function all(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (error, rows) => {
            if (error) {
                reject(error);
            } else {
                resolve(rows);
            }
        });
    });
}

async function main() {
    console.log("Database migration starting...");
    console.log("Database:", dbPath);

    // --------------------------------------------------------
    // Check stock_transactions columns
    // --------------------------------------------------------

    const columns = await all(
        "PRAGMA table_info(stock_transactions)"
    );

    const names = columns.map(
        column => column.name
    );

    console.log(
        "Existing stock_transactions columns:",
        names
    );

    // --------------------------------------------------------
    // Add order_id if missing
    // --------------------------------------------------------

    if (!names.includes("order_id")) {
        console.log(
            "Adding stock_transactions.order_id..."
        );

        await run(`
            ALTER TABLE stock_transactions
            ADD COLUMN order_id INTEGER
        `);

        console.log(
            "order_id added."
        );
    } else {
        console.log(
            "order_id already exists."
        );
    }

    // --------------------------------------------------------
    // Add order_item_id if missing
    // --------------------------------------------------------

    if (!names.includes("order_item_id")) {
        console.log(
            "Adding stock_transactions.order_item_id..."
        );

        await run(`
            ALTER TABLE stock_transactions
            ADD COLUMN order_item_id INTEGER
        `);

        console.log(
            "order_item_id added."
        );
    } else {
        console.log(
            "order_item_id already exists."
        );
    }

    // --------------------------------------------------------
    // Check orders table
    // --------------------------------------------------------

    const orderColumns = await all(
        "PRAGMA table_info(orders)"
    );

    const orderNames =
        orderColumns.map(
            column => column.name
        );

    console.log(
        "Existing orders columns:",
        orderNames
    );

    // --------------------------------------------------------
    // Required order columns
    // --------------------------------------------------------

    const orderColumnsToAdd = [
        {
            name: "date",
            sql: "ALTER TABLE orders ADD COLUMN date TEXT"
        },
        {
            name: "time",
            sql: "ALTER TABLE orders ADD COLUMN time TEXT"
        },
        {
            name: "delivered_to",
            sql: "ALTER TABLE orders ADD COLUMN delivered_to TEXT"
        },
        {
            name: "sender_id",
            sql: "ALTER TABLE orders ADD COLUMN sender_id INTEGER"
        },
        {
            name: "whatsapp_message_id",
            sql: "ALTER TABLE orders ADD COLUMN whatsapp_message_id TEXT"
        },
        {
            name: "whatsapp_from",
            sql: "ALTER TABLE orders ADD COLUMN whatsapp_from TEXT"
        },
        {
            name: "total_items",
            sql: "ALTER TABLE orders ADD COLUMN total_items INTEGER DEFAULT 0"
        },
        {
            name: "accepted_items",
            sql: "ALTER TABLE orders ADD COLUMN accepted_items INTEGER DEFAULT 0"
        },
        {
            name: "rejected_items",
            sql: "ALTER TABLE orders ADD COLUMN rejected_items INTEGER DEFAULT 0"
        },
        {
            name: "status",
            sql: "ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'PENDING'"
        },
        {
            name: "confirmation_sent",
            sql: "ALTER TABLE orders ADD COLUMN confirmation_sent INTEGER DEFAULT 0"
        },
        {
            name: "confirmation_message_id",
            sql: "ALTER TABLE orders ADD COLUMN confirmation_message_id TEXT"
        }
    ];

    for (
        const column of orderColumnsToAdd
    ) {
        if (
            !orderNames.includes(
                column.name
            )
        ) {
            console.log(
                `Adding orders.${column.name}...`
            );

            await run(
                column.sql
            );
        }
    }

    // --------------------------------------------------------
    // Check order_items
    // --------------------------------------------------------

    const orderItemColumns =
        await all(
            "PRAGMA table_info(order_items)"
        );

    const orderItemNames =
        orderItemColumns.map(
            column => column.name
        );

    const orderItemColumnsToAdd = [
        {
            name: "order_id",
            sql: "ALTER TABLE order_items ADD COLUMN order_id INTEGER"
        },
        {
            name: "item_name",
            sql: "ALTER TABLE order_items ADD COLUMN item_name TEXT"
        },
        {
            name: "requested_quantity",
            sql: "ALTER TABLE order_items ADD COLUMN requested_quantity REAL DEFAULT 0"
        },
        {
            name: "accepted_quantity",
            sql: "ALTER TABLE order_items ADD COLUMN accepted_quantity REAL DEFAULT 0"
        },
        {
            name: "rejected_quantity",
            sql: "ALTER TABLE order_items ADD COLUMN rejected_quantity REAL DEFAULT 0"
        },
        {
            name: "status",
            sql: "ALTER TABLE order_items ADD COLUMN status TEXT DEFAULT 'REJECTED'"
        },
        {
            name: "rejection_reason",
            sql: "ALTER TABLE order_items ADD COLUMN rejection_reason TEXT"
        }
    ];

    for (
        const column of orderItemColumnsToAdd
    ) {
        if (
            !orderItemNames.includes(
                column.name
            )
        ) {
            console.log(
                `Adding order_items.${column.name}...`
            );

            await run(
                column.sql
            );
        }
    }

    // --------------------------------------------------------
    // Check processed_messages
    // --------------------------------------------------------

    const processedColumns =
        await all(
            "PRAGMA table_info(processed_messages)"
        );

    const processedNames =
        processedColumns.map(
            column => column.name
        );

    const processedColumnsToAdd = [
        {
            name: "whatsapp_from",
            sql: "ALTER TABLE processed_messages ADD COLUMN whatsapp_from TEXT"
        },
        {
            name: "sender_phone",
            sql: "ALTER TABLE processed_messages ADD COLUMN sender_phone TEXT"
        },
        {
            name: "body",
            sql: "ALTER TABLE processed_messages ADD COLUMN body TEXT"
        },
        {
            name: "processed_at",
            sql: "ALTER TABLE processed_messages ADD COLUMN processed_at TEXT DEFAULT CURRENT_TIMESTAMP"
        }
    ];

    for (
        const column of processedColumnsToAdd
    ) {
        if (
            !processedNames.includes(
                column.name
            )
        ) {
            console.log(
                `Adding processed_messages.${column.name}...`
            );

            await run(
                column.sql
            );
        }
    }

    // --------------------------------------------------------
    // LID mapping table
    // --------------------------------------------------------

    await run(`
        CREATE TABLE IF NOT EXISTS whatsapp_lid_map (
            lid TEXT PRIMARY KEY,
            phone TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("");
    console.log(
        "=========================================="
    );
    console.log(
        "DATABASE MIGRATION COMPLETE"
    );
    console.log(
        "=========================================="
    );

    db.close();
}

main().catch(error => {
    console.error("");
    console.error(
        "DATABASE MIGRATION FAILED"
    );
    console.error(
        error.stack || error
    );

    db.close();
     process.exit(1);
});