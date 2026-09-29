"use strict";

/*
=========================================================
 DELIVERY & STOCK MANAGER
 Complete frontend
=========================================================
*/

const API = "";

let currentSection = "dashboard";
let allOrders = [];
let allItems = [];
let allTransactions = [];
let allSenders = [];
let whatsappStatus = null;

// ======================================================
// DOM
// ======================================================

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "0";
    }

    return Number.isInteger(number)
        ? String(number)
        : number.toFixed(2).replace(/\.?0+$/, "");
}

function formatDateTime(date, time) {
    if (date && time) {
        return `${date} ${time}`;
    }

    return date || time || "-";
}

function showLoading(elementId, text = "Loading...") {
    const element = $(elementId);

    if (element) {
        element.innerHTML = `
            <div class="loading">
                ${escapeHtml(text)}
            </div>
        `;
    }
}

function showEmpty(elementId, text = "No records found.") {
    const element = $(elementId);

    if (element) {
        element.innerHTML = `
            <div class="empty-state">
                ${escapeHtml(text)}
            </div>
        `;
    }
}

// ======================================================
// API
// ======================================================

async function api(url, options = {}) {
    const response = await fetch(API + url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            data?.message ||
            data?.error ||
            `Request failed (${response.status})`
        );
    }

    return data;
}

// ======================================================
// TOAST
// ======================================================

function toast(message, type = "info") {
    const container = $("toastContainer");

    if (!container) {
        alert(message);
        return;
    }

    const item = document.createElement("div");

    item.className = `toast ${type}`;

    item.innerHTML = `
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(item);

    setTimeout(() => {
        item.classList.add("hide");

        setTimeout(() => {
            item.remove();
        }, 300);
    }, 3000);
}

// ======================================================
// SECTION INFORMATION
// ======================================================

const sectionInfo = {
    dashboard: {
        title: "Dashboard",
        subtitle: "Overview of your deliveries and stock"
    },

    deliveries: {
        title: "Delivery Records",
        subtitle: "All deliveries recorded from WhatsApp or manually."
    },

    stock: {
        title: "Stock Management",
        subtitle: "Manage available stock and minimum stock levels."
    },

    transactions: {
        title: "Stock Transaction History",
        subtitle: "Incoming and outgoing stock movements."
    },

    senders: {
        title: "WhatsApp Senders",
        subtitle: "Manage authorized WhatsApp phone numbers."
    }
};

// ======================================================
// NAVIGATION
// ======================================================

function openSection(sectionName) {
    if (!sectionInfo[sectionName]) {
        sectionName = "dashboard";
    }

    currentSection = sectionName;

    document
        .querySelectorAll(".page-section")
        .forEach(section => {
            section.classList.remove("active");
        });

    const section = $(`${sectionName}Section`);

    if (section) {
        section.classList.add("active");
    }

    document
        .querySelectorAll(".nav-item")
        .forEach(button => {
            button.classList.remove("active");

            if (
                button.dataset.section ===
                sectionName
            ) {
                button.classList.add("active");
            }
        });

    const info = sectionInfo[sectionName];

    if ($("pageTitle")) {
        $("pageTitle").textContent = info.title;
    }

    if ($("pageSubtitle")) {
        $("pageSubtitle").textContent = info.subtitle;
    }

    const sidebar = $("sidebar");

    if (sidebar) {
        sidebar.classList.remove("open");
    }

    loadSectionData(sectionName);
}

async function loadSectionData(sectionName) {
    try {
        switch (sectionName) {
            case "dashboard":
                await Promise.all([
                    loadDashboard(),
                    loadWhatsAppStatus()
                ]);
                break;

            case "deliveries":
                await loadOrders();
                break;

            case "stock":
                await loadItems();
                break;

            case "transactions":
                await loadTransactions();
                break;

            case "senders":
                await loadSenders();
                break;
        }
    } catch (error) {
        console.error(
            "Section load error:",
            error
        );

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// DASHBOARD
// ======================================================

async function loadDashboard() {
    try {
        const data =
            await api("/api/dashboard");

        if ($("totalDeliveries")) {
            $("totalDeliveries").textContent =
                formatNumber(
                    data.totalOrders ??
                    data.totalDeliveries ??
                    0
                );
        }

        if ($("totalItems")) {
            $("totalItems").textContent =
                formatNumber(
                    data.totalStockItems ??
                    data.totalItems ??
                    0
                );
        }

        if ($("lowStockItems")) {
            $("lowStockItems").textContent =
                formatNumber(
                    data.lowStockItems ??
                    0
                );
        }

        await loadRecentDeliveries();
        await loadLowStock();
        await loadSendersCount();

    } catch (error) {
        console.error(
            "Dashboard error:",
            error
        );

        toast(
            "Could not load dashboard.",
            "error"
        );
    }
}

// ======================================================
// RECENT DELIVERIES
// ======================================================

async function loadRecentDeliveries() {
    try {
        const data =
            await api("/api/orders");

        allOrders =
            extractArray(data);

        const recent =
            allOrders.slice(0, 5);

        renderRecentDeliveries(recent);

    } catch (error) {
        console.error(
            "Recent deliveries error:",
            error
        );

        if ($("recentDeliveries")) {
            $("recentDeliveries").innerHTML = `
                <div class="empty-state">
                    Could not load deliveries.
                </div>
            `;
        }
    }
}

function renderRecentDeliveries(orders) {
    const container =
        $("recentDeliveries");

    if (!container) return;

    if (!orders.length) {
        showEmpty(
            "recentDeliveries",
            "No deliveries recorded yet."
        );

        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Delivered To</th>
                    <th>Items</th>
                    <th>Status</th>
                </tr>
            </thead>

            <tbody>
                ${orders.map(order => `
                    <tr
                        class="clickable-row"
                        data-order-id="${escapeHtml(order.id)}"
                    >

                        <td>
                            #${escapeHtml(order.id)}
                        </td>

                        <td>
                            ${escapeHtml(
                                order.delivered_to ??
                                order.deliveredTo ??
                                "-"
                            )}
                        </td>

                        <td>
                            ${formatNumber(
                                order.total_items ??
                                order.totalItems ??
                                0
                            )}
                        </td>

                        <td>
                            ${statusBadge(order.status)}
                        </td>

                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;

    container
        .querySelectorAll("[data-order-id]")
        .forEach(row => {
            row.addEventListener(
                "click",
                () => {
                    openOrderDetails(
                        row.dataset.orderId
                    );
                }
            );
        });
}

// ======================================================
// LOW STOCK
// ======================================================

async function loadLowStock() {
    try {
        const data =
            await api("/api/items");

        allItems =
            extractArray(data);

        const lowStock =
            allItems.filter(item => {

                const stock =
                    Number(
                        item.current_stock ??
                        item.currentStock ??
                        0
                    );

                const minimum =
                    Number(
                        item.minimum_stock ??
                        item.minimumStock ??
                        0
                    );

                return stock <= minimum;
            });

        renderLowStock(lowStock);

    } catch (error) {
        console.error(
            "Low stock error:",
            error
        );
    }
}

function renderLowStock(items) {
    const container =
        $("lowStockList");

    if (!container) return;

    if (!items.length) {
        container.innerHTML = `
            <div class="empty-state">
                No low-stock items.
            </div>
        `;

        return;
    }

    container.innerHTML =
        items.map(item => {

            const stock =
                Number(
                    item.current_stock ??
                    item.currentStock ??
                    0
                );

            const minimum =
                Number(
                    item.minimum_stock ??
                    item.minimumStock ??
                    0
                );

            return `
                <div class="low-stock-item">

                    <div>
                        <strong>
                            ${escapeHtml(item.name)}
                        </strong>

                        <small>
                            Minimum:
                            ${formatNumber(minimum)}
                        </small>
                    </div>

                    <strong>
                        ${formatNumber(stock)}
                    </strong>

                </div>
            `;
        }).join("");
}

// ======================================================
// SENDERS COUNT
// ======================================================

async function loadSendersCount() {
    try {
        const data =
            await api("/api/senders");

        allSenders =
            extractArray(data);

        if ($("totalSenders")) {
            $("totalSenders").textContent =
                formatNumber(
                    allSenders.length
                );
        }

    } catch (error) {
        console.error(
            "Sender count error:",
            error
        );
    }
}

// ======================================================
// DELIVERIES
// ======================================================

async function loadOrders() {
    showLoading(
        "deliveriesTable",
        "Loading deliveries..."
    );

    try {
        const data =
            await api("/api/orders");

        allOrders =
            extractArray(data);

        /*
         * IMPORTANT:
         * /api/orders gives the order summary.
         *
         * We additionally request /api/orders/:id
         * so that every delivery can display:
         *
         * Item name
         * Requested quantity
         * Accepted quantity
         * Rejected quantity
         * Item status
         */

        const detailedOrders =
            await Promise.all(
                allOrders.map(
                    async order => {

                        try {
                            const detail =
                                await api(
                                    `/api/orders/${encodeURIComponent(
                                        order.id
                                    )}`
                                );

                            const detailedOrder =
                                detail.order ??
                                detail;

                            const items =
                                detail.items ??
                                detail.order_items ??
                                detailedOrder.items ??
                                detailedOrder.order_items ??
                                [];

                            return {
                                ...order,
                                items
                            };

                        } catch (error) {

                            console.error(
                                `Could not load items for order #${order.id}:`,
                                error
                            );

                            return {
                                ...order,
                                items: []
                            };
                        }
                    }
                )
            );

        allOrders =
            detailedOrders;

        renderOrders(
            allOrders
        );

    } catch (error) {

        console.error(
            "Orders error:",
            error
        );

        if ($("deliveriesTable")) {
            $("deliveriesTable").innerHTML = `
                <div class="empty-state">
                    ${escapeHtml(error.message)}
                </div>
            `;
        }
    }
}

// ======================================================
// UPDATED DELIVERY TABLE
// ======================================================

function renderOrders(orders) {
    const container =
        $("deliveriesTable");

    if (!container) return;

    if (!orders.length) {
        showEmpty(
            "deliveriesTable",
            "No delivery records found."
        );

        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Delivered To</th>
                    <th>Items</th>
                    <th>Accepted</th>
                    <th>Rejected</th>
                    <th>Status</th>
                </tr>
            </thead>

            <tbody>

                ${orders.map(order => {

                    const items =
                        Array.isArray(order.items)
                            ? order.items
                            : [];

                    const itemDisplay =
                        items.length

                        ? items.map(item => {

                            const itemName =
                                item.item_name ??
                                item.itemName ??
                                item.name ??
                                "Unknown item";

                            const requested =
                                Number(
                                    item.requested_quantity ??
                                    item.requestedQuantity ??
                                    0
                                );

                            const accepted =
                                Number(
                                    item.accepted_quantity ??
                                    item.acceptedQuantity ??
                                    0
                                );

                            const rejected =
                                Number(
                                    item.rejected_quantity ??
                                    item.rejectedQuantity ??
                                    0
                                );

                            const itemStatus =
                                String(
                                    item.status ??
                                    ""
                                ).toUpperCase();

                            let statusHtml = "";

                            if (
                                itemStatus ===
                                    "ACCEPTED" ||
                                accepted > 0
                            ) {
                                statusHtml = `
                                    <span
                                        class="item-accepted"
                                        style="
                                            color:#15803d;
                                            font-size:12px;
                                            font-weight:600;
                                        "
                                    >
                                        ✓ ${formatNumber(
                                            accepted
                                        )} accepted
                                    </span>
                                `;
                            }

                            if (
                                itemStatus ===
                                    "REJECTED" ||
                                rejected > 0
                            ) {
                                statusHtml = `
                                    <span
                                        class="item-rejected"
                                        style="
                                            color:#dc2626;
                                            font-size:12px;
                                            font-weight:600;
                                        "
                                    >
                                        ✕ ${formatNumber(
                                            rejected
                                        )} rejected
                                    </span>
                                `;
                            }

                            return `
                                <div
                                    class="order-item-line"
                                    style="
                                        margin-bottom:8px;
                                        padding-bottom:8px;
                                        border-bottom:1px solid #e5e7eb;
                                    "
                                >

                                    <div
                                        style="
                                            font-weight:600;
                                            margin-bottom:3px;
                                        "
                                    >
                                        ${escapeHtml(
                                            itemName
                                        )}

                                        <span
                                            style="
                                                font-weight:400;
                                                color:#64748b;
                                            "
                                        >
                                            × ${formatNumber(
                                                requested
                                            )}
                                        </span>
                                    </div>

                                    <div>
                                        ${statusHtml}
                                    </div>

                                    ${
                                        item.rejection_reason
                                            ? `
                                                <div
                                                    style="
                                                        color:#dc2626;
                                                        font-size:11px;
                                                        margin-top:2px;
                                                    "
                                                >
                                                    ${escapeHtml(
                                                        item.rejection_reason
                                                    )}
                                                </div>
                                            `
                                            : ""
                                    }

                                </div>
                            `;

                        }).join("")

                        : `
                            <span>
                                ${formatNumber(
                                    order.total_items ??
                                    order.totalItems ??
                                    0
                                )}
                                item(s)
                            </span>
                        `;

                    return `
                        <tr
                            class="clickable-row"
                            data-order-id="${escapeHtml(
                                order.id
                            )}"
                        >

                            <td>
                                <strong>
                                    #${escapeHtml(
                                        order.id
                                    )}
                                </strong>
                            </td>

                            <td>
                                ${escapeHtml(
                                    formatDateTime(
                                        order.date,
                                        order.time
                                    )
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    order.delivered_to ??
                                    order.deliveredTo ??
                                    "-"
                                )}
                            </td>

                            <td
                                style="
                                    min-width:220px;
                                    vertical-align:top;
                                "
                            >
                                <div
                                    class="order-items-list"
                                >
                                    ${itemDisplay}
                                </div>
                            </td>

                            <td>
                                ${formatNumber(
                                    order.accepted_items ??
                                    order.acceptedItems ??
                                    0
                                )}
                            </td>

                            <td>
                                ${formatNumber(
                                    order.rejected_items ??
                                    order.rejectedItems ??
                                    0
                                )}
                            </td>

                            <td>
                                ${statusBadge(
                                    order.status
                                )}
                            </td>

                        </tr>
                    `;
                }).join("")}

            </tbody>
        </table>
    `;

    container
        .querySelectorAll(
            "[data-order-id]"
        )
        .forEach(row => {

            row.addEventListener(
                "click",
                () => {
                    openOrderDetails(
                        row.dataset.orderId
                    );
                }
            );
        });
}

// ======================================================
// DELIVERY SEARCH
// ======================================================

function filterOrders() {
    const search =
        $("deliverySearch")
            ?.value
            ?.trim()
            .toLowerCase() || "";

    const date =
        $("deliveryDateFilter")
            ?.value || "";

    const filtered =
        allOrders.filter(order => {

            const deliveredTo =
                String(
                    order.delivered_to ??
                    order.deliveredTo ??
                    ""
                ).toLowerCase();

            const sender =
                String(
                    order.whatsapp_from ??
                    order.whatsappFrom ??
                    ""
                ).toLowerCase();

            const id =
                String(order.id ?? "");

            const itemText =
                Array.isArray(order.items)
                    ? order.items
                        .map(item =>
                            item.item_name ??
                            item.itemName ??
                            item.name ??
                            ""
                        )
                        .join(" ")
                        .toLowerCase()
                    : "";

            const matchesSearch =
                !search ||
                deliveredTo.includes(search) ||
                sender.includes(search) ||
                id.includes(search) ||
                itemText.includes(search);

            const matchesDate =
                !date ||
                String(
                    order.date ?? ""
                ).startsWith(date);

            return (
                matchesSearch &&
                matchesDate
            );
        });

    renderOrders(filtered);
}

// ======================================================
// ORDER DETAILS
// ======================================================

async function openOrderDetails(orderId) {
    try {
        const data =
            await api(
                `/api/orders/${encodeURIComponent(
                    orderId
                )}`
            );

        const order =
            data.order ??
            data;

        const items =
            data.items ??
            data.order_items ??
            order.items ??
            order.order_items ??
            [];

        const html = `
            <div class="order-details">

                <div class="detail-grid">

                    <div>
                        <small>Order</small>
                        <strong>
                            #${escapeHtml(order.id)}
                        </strong>
                    </div>

                    <div>
                        <small>Status</small>
                        ${statusBadge(
                            order.status
                        )}
                    </div>

                    <div>
                        <small>Delivered To</small>
                        <strong>
                            ${escapeHtml(
                                order.delivered_to ??
                                order.deliveredTo ??
                                "-"
                            )}
                        </strong>
                    </div>

                    <div>
                        <small>Date</small>
                        <strong>
                            ${escapeHtml(
                                formatDateTime(
                                    order.date,
                                    order.time
                                )
                            )}
                        </strong>
                    </div>

                </div>

                <hr>

                <h3>Items</h3>

                ${
                    items.length
                        ? `
                            <table>

                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>Requested</th>
                                        <th>Accepted</th>
                                        <th>Rejected</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>

                                <tbody>

                                    ${items.map(item => `
                                        <tr>

                                            <td>
                                                ${escapeHtml(
                                                    item.item_name ??
                                                    item.itemName ??
                                                    item.name ??
                                                    "-"
                                                )}
                                            </td>

                                            <td>
                                                ${formatNumber(
                                                    item.requested_quantity ??
                                                    item.requestedQuantity ??
                                                    0
                                                )}
                                            </td>

                                            <td>
                                                ${formatNumber(
                                                    item.accepted_quantity ??
                                                    item.acceptedQuantity ??
                                                    0
                                                )}
                                            </td>

                                            <td>
                                                ${formatNumber(
                                                    item.rejected_quantity ??
                                                    item.rejectedQuantity ??
                                                    0
                                                )}
                                            </td>

                                            <td>
                                                ${statusBadge(
                                                    item.status
                                                )}
                                            </td>

                                        </tr>
                                    `).join("")}

                                </tbody>

                            </table>
                        `
                        : `
                            <p>
                                No item details available.
                            </p>
                        `
                }

            </div>
        `;

        openModal(
            `Order #${order.id}`,
            "Delivery details",
            html
        );

    } catch (error) {
        console.error(
            "Order details error:",
            error
        );

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// STOCK
// ======================================================

async function loadItems() {
    showLoading(
        "stockTable",
        "Loading stock..."
    );

    try {
        const data =
            await api("/api/items");

        allItems =
            extractArray(data);

        renderItems(allItems);

    } catch (error) {

        console.error(
            "Items error:",
            error
        );

        if ($("stockTable")) {
            $("stockTable").innerHTML = `
                <div class="empty-state">
                    ${escapeHtml(
                        error.message
                    )}
                </div>
            `;
        }
    }
}

function renderItems(items) {
    const container =
        $("stockTable");

    if (!container) return;

    if (!items.length) {
        showEmpty(
            "stockTable",
            "No stock items found."
        );

        return;
    }

    container.innerHTML = `
        <table>

            <thead>
                <tr>
                    <th>Item</th>
                    <th>Opening Stock</th>
                    <th>Current Stock</th>
                    <th>Minimum Stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>

            <tbody>

                ${items.map(item => {

                    const current =
                        Number(
                            item.current_stock ??
                            item.currentStock ??
                            0
                        );

                    const minimum =
                        Number(
                            item.minimum_stock ??
                            item.minimumStock ??
                            0
                        );

                    const low =
                        current <= minimum;

                    return `
                        <tr>

                            <td>
                                <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                </strong>
                            </td>

                            <td>
                                ${formatNumber(
                                    item.opening_stock ??
                                    item.openingStock ??
                                    0
                                )}
                            </td>

                            <td>
                                <strong>
                                    ${formatNumber(
                                        current
                                    )}
                                </strong>
                            </td>

                            <td>
                                ${formatNumber(
                                    minimum
                                )}
                            </td>

                            <td>
                                ${
                                    low
                                        ? `
                                            <span
                                                class="status-badge rejected"
                                            >
                                                LOW
                                            </span>
                                        `
                                        : `
                                            <span
                                                class="status-badge success"
                                            >
                                                OK
                                            </span>
                                        `
                                }
                            </td>

                            <td>

                                <div
                                    class="action-buttons"
                                >

                                    <button
                                        class="small-button"
                                        data-add-stock="${escapeHtml(
                                            item.id
                                        )}"
                                    >
                                        + Stock
                                    </button>

                                    <button
                                        class="small-button danger"
                                        data-delete-item="${escapeHtml(
                                            item.id
                                        )}"
                                    >
                                        Delete
                                    </button>

                                </div>

                            </td>

                        </tr>
                    `;
                }).join("")}

            </tbody>

        </table>
    `;

    container
        .querySelectorAll(
            "[data-add-stock]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {
                    openAddStockModal(
                        button.dataset.addStock
                    );
                }
            );
        });

    container
        .querySelectorAll(
            "[data-delete-item]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {
                    deleteItem(
                        button.dataset.deleteItem
                    );
                }
            );
        });
}

// ======================================================
// ADD ITEM
// ======================================================

function openAddItemModal() {
    const html = `
        <form id="addItemForm">

            <label>
                Item Name

                <input
                    id="itemNameInput"
                    type="text"
                    required
                    placeholder="e.g. Bolt"
                >
            </label>

            <label>
                Opening Stock

                <input
                    id="itemOpeningStockInput"
                    type="number"
                    min="0"
                    step="any"
                    value="0"
                    required
                >
            </label>

            <label>
                Minimum Stock

                <input
                    id="itemMinimumStockInput"
                    type="number"
                    min="0"
                    step="any"
                    value="0"
                    required
                >
            </label>

            <button
                type="submit"
                class="primary-button"
            >
                Add Item
            </button>

        </form>
    `;

    openModal(
        "Add Stock Item",
        "Create a new inventory item",
        html
    );

    $("addItemForm")
        ?.addEventListener(
            "submit",
            addItem
        );
}

async function addItem(event) {
    event.preventDefault();

    const name =
        $("itemNameInput")
            ?.value
            ?.trim();

    const openingStock =
        Number(
            $("itemOpeningStockInput")
                ?.value || 0
        );

    const minimumStock =
        Number(
            $("itemMinimumStockInput")
                ?.value || 0
        );

    if (!name) {
        toast(
            "Enter an item name.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/api/items",
            {
                method: "POST",

                body: JSON.stringify({
                    name,
                    opening_stock:
                        openingStock,
                    minimum_stock:
                        minimumStock
                })
            }
        );

        closeModal();

        toast(
            "Item added successfully.",
            "success"
        );

        await loadItems();
        await loadDashboard();

    } catch (error) {
        console.error(error);
        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// ADD STOCK
// ======================================================

function openAddStockModal(itemId) {
    const item =
        allItems.find(
            current =>
                String(current.id) ===
                String(itemId)
        );

    if (!item) {
        toast(
            "Item not found.",
            "error"
        );

        return;
    }

    const html = `
        <form id="addStockForm">

            <div class="info-banner">

                <strong>
                    ${escapeHtml(item.name)}
                </strong>

                <p>
                    Current stock:
                    ${formatNumber(
                        item.current_stock ??
                        item.currentStock ??
                        0
                    )}
                </p>

            </div>

            <label>
                Quantity to Add

                <input
                    id="stockQuantityInput"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                >
            </label>

            <label>
                Reason

                <input
                    id="stockReasonInput"
                    type="text"
                    value="Manual stock addition"
                >
            </label>

            <button
                type="submit"
                class="primary-button"
            >
                Add Stock
            </button>

        </form>
    `;

    openModal(
        "Add Stock",
        item.name,
        html
    );

    $("addStockForm")
        ?.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                const quantity =
                    Number(
                        $("stockQuantityInput")
                            ?.value
                    );

                const reason =
                    $("stockReasonInput")
                        ?.value
                        ?.trim() ||
                    "Manual stock addition";

                if (
                    !Number.isFinite(
                        quantity
                    ) ||
                    quantity <= 0
                ) {
                    toast(
                        "Enter a valid quantity.",
                        "error"
                    );

                    return;
                }

                try {
                    await api(
                        `/api/items/${encodeURIComponent(
                            itemId
                        )}/stock`,
                        {
                            method: "POST",

                            body:
                                JSON.stringify({
                                    quantity,
                                    reason
                                })
                        }
                    );

                    closeModal();

                    toast(
                        "Stock updated successfully.",
                        "success"
                    );

                    await loadItems();
                    await loadDashboard();

                } catch (error) {
                    console.error(error);

                    toast(
                        error.message,
                        "error"
                    );
                }
            }
        );
}

// ======================================================
// DELETE ITEM
// ======================================================

async function deleteItem(itemId) {
    const item =
        allItems.find(
            current =>
                String(current.id) ===
                String(itemId)
        );

    if (!item) return;

    if (
        !confirm(
            `Delete "${item.name}"?\n\nThis cannot be undone.`
        )
    ) {
        return;
    }

    try {
        await api(
            `/api/items/${encodeURIComponent(
                itemId
            )}`,
            {
                method: "DELETE"
            }
        );

        toast(
            "Item deleted.",
            "success"
        );

        await loadItems();
        await loadDashboard();

    } catch (error) {
        console.error(error);

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// TRANSACTIONS
// ======================================================

async function loadTransactions() {
    showLoading(
        "transactionsTable",
        "Loading history..."
    );

    try {
        const data =
            await api(
                "/api/transactions"
            );

        allTransactions =
            extractArray(data);

        renderTransactions(
            allTransactions
        );

    } catch (error) {

        console.error(
            "Transactions error:",
            error
        );

        if ($("transactionsTable")) {
            $("transactionsTable").innerHTML = `
                <div class="empty-state">
                    ${escapeHtml(
                        error.message
                    )}
                </div>
            `;
        }
    }
}

function renderTransactions(transactions) {
    const container =
        $("transactionsTable");

    if (!container) return;

    if (!transactions.length) {
        showEmpty(
            "transactionsTable",
            "No stock transactions found."
        );

        return;
    }

    container.innerHTML = `
        <table>

            <thead>
                <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th>Type</th>
                    <th>Quantity</th>
                    <th>Reason</th>
                    <th>Order</th>
                </tr>
            </thead>

            <tbody>

                ${transactions.map(transaction => {

                    const type =
                        String(
                            transaction.type ??
                            ""
                        ).toUpperCase();

                    return `
                        <tr>

                            <td>
                                ${escapeHtml(
                                    transaction.created_at ??
                                    transaction.createdAt ??
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    transaction.item_name ??
                                    transaction.itemName ??
                                    transaction.name ??
                                    "-"
                                )}
                            </td>

                            <td>
                                ${
                                    type === "IN"
                                        ? `
                                            <span
                                                class="status-badge success"
                                            >
                                                IN
                                            </span>
                                        `
                                        : `
                                            <span
                                                class="status-badge rejected"
                                            >
                                                OUT
                                            </span>
                                        `
                                }
                            </td>

                            <td>
                                ${formatNumber(
                                    transaction.quantity
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    transaction.reason ??
                                    "-"
                                )}
                            </td>

                            <td>
                                ${
                                    transaction.order_id
                                        ? `#${escapeHtml(
                                            transaction.order_id
                                        )}`
                                        : "-"
                                }
                            </td>

                        </tr>
                    `;
                }).join("")}

            </tbody>

        </table>
    `;
}

function filterTransactions() {
    const search =
        $("transactionSearch")
            ?.value
            ?.trim()
            .toLowerCase() || "";

    const filtered =
        allTransactions.filter(
            transaction => {

                const text = [
                    transaction.item_name,
                    transaction.itemName,
                    transaction.name,
                    transaction.reason,
                    transaction.type,
                    transaction.order_id
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return text.includes(
                    search
                );
            }
        );

    renderTransactions(
        filtered
    );
}

// ======================================================
// SENDERS
// ======================================================

async function loadSenders() {
    showLoading(
        "sendersTable",
        "Loading senders..."
    );

    try {
        const data =
            await api("/api/senders");

        allSenders =
            extractArray(data);

        renderSenders(
            allSenders
        );

        if ($("totalSenders")) {
            $("totalSenders").textContent =
                formatNumber(
                    allSenders.length
                );
        }

    } catch (error) {

        console.error(
            "Senders error:",
            error
        );

        if ($("sendersTable")) {
            $("sendersTable").innerHTML = `
                <div class="empty-state">
                    ${escapeHtml(
                        error.message
                    )}
                </div>
            `;
        }
    }
}

function renderSenders(senders) {
    const container =
        $("sendersTable");

    if (!container) return;

    if (!senders.length) {
        showEmpty(
            "sendersTable",
            "No authorized senders added yet."
        );

        return;
    }

    container.innerHTML = `
        <table>

            <thead>
                <tr>
                    <th>Name</th>
                    <th>WhatsApp Number</th>
                    <th>Added</th>
                    <th>Action</th>
                </tr>
            </thead>

            <tbody>

                ${senders.map(sender => `
                    <tr>

                        <td>
                            ${escapeHtml(
                                sender.name ??
                                "-"
                            )}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(
                                    sender.whatsapp_id ??
                                    sender.whatsappId ??
                                    sender.phone ??
                                    sender.number ??
                                    "-"
                                )}
                            </strong>
                        </td>

                        <td>
                            ${escapeHtml(
                                sender.created_at ??
                                sender.createdAt ??
                                "-"
                            )}
                        </td>

                        <td>
                            <button
                                class="small-button danger"
                                data-delete-sender="${escapeHtml(
                                    sender.id
                                )}"
                            >
                                Remove
                            </button>
                        </td>

                    </tr>
                `).join("")}

            </tbody>

        </table>
    `;

    container
        .querySelectorAll(
            "[data-delete-sender]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {
                    deleteSender(
                        button.dataset.deleteSender
                    );
                }
            );
        });
}

// ======================================================
// ADD SENDER
// ======================================================

function openAddSenderModal() {
    const html = `
        <form id="addSenderForm">

            <label>
                Sender Name

                <input
                    id="senderNameInput"
                    type="text"
                    required
                    placeholder="e.g. Rahul"
                >
            </label>

            <label>
                WhatsApp Phone Number

                <input
                    id="senderPhoneInput"
                    type="text"
                    required
                    placeholder="919876543210"
                >
            </label>

            <div class="info-banner">

                <strong>
                    Use the real phone number
                </strong>

                <p>
                    Include the country code.
                    Example: 919876543210
                </p>

            </div>

            <button
                type="submit"
                class="primary-button"
            >
                Add Sender
            </button>

        </form>
    `;

    openModal(
        "Add WhatsApp Sender",
        "Authorize a phone number",
        html
    );

    $("addSenderForm")
        ?.addEventListener(
            "submit",
            addSender
        );
}

async function addSender(event) {
    event.preventDefault();

    const name =
        $("senderNameInput")
            ?.value
            ?.trim();

    const phone =
        $("senderPhoneInput")
            ?.value
            ?.trim()
            .replace(/\D/g, "");

    if (!name) {
        toast(
            "Enter the sender name.",
            "error"
        );

        return;
    }

    if (!phone) {
        toast(
            "Enter the WhatsApp phone number.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/api/senders",
            {
                method: "POST",

                body:
                    JSON.stringify({
                        name,
                        whatsapp_id: phone,
                        phone
                    })
            }
        );

        closeModal();

        toast(
            "Sender added successfully.",
            "success"
        );

        await loadSenders();
        await loadDashboard();

    } catch (error) {
        console.error(error);

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// DELETE SENDER
// ======================================================

async function deleteSender(senderId) {
    if (
        !confirm(
            "Remove this WhatsApp sender from the allowlist?"
        )
    ) {
        return;
    }

    try {
        await api(
            `/api/senders/${encodeURIComponent(
                senderId
            )}`,
            {
                method: "DELETE"
            }
        );

        toast(
            "Sender removed.",
            "success"
        );

        await loadSenders();
        await loadDashboard();

    } catch (error) {
        console.error(error);

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// ======================================================
// WHATSAPP STATUS
// ======================================================

let whatsappQRRetryTimer = null;

async function loadWhatsAppStatus() {

    try {

        const data =
            await api(
                "/api/whatsapp/status"
            );

        whatsappStatus =
            data.status
                ? data
                : data.data ?? data;

        renderWhatsAppStatus(
            whatsappStatus
        );

    } catch (error) {

        console.error(
            "WhatsApp status error:",
            error
        );

        setWhatsAppStatus(
            "disconnected",
            "Disconnected"
        );

        /*
         * Even if the status API temporarily fails,
         * try to find a QR.
         */

        loadWhatsAppQR();
    }
}


function renderWhatsAppStatus(data) {

    if (!data) {
        return;
    }

    const rawStatus =
        String(
            data.status ??
            data.state ??
            "unknown"
        ).toLowerCase();

    let status = rawStatus;

    if (
        rawStatus === "ready" ||
        rawStatus === "connected"
    ) {
        status = "connected";
    }

    if (
        rawStatus === "qr" ||
        rawStatus === "qr_required" ||
        rawStatus === "waiting_for_qr"
    ) {
        status = "qr";
    }

    if (
        rawStatus === "disconnected" ||
        rawStatus === "auth_failure"
    ) {
        status = "disconnected";
    }

    if (
        rawStatus === "authenticated"
    ) {
        status = "connecting";
    }

    if (
        rawStatus === "starting"
    ) {
        status = "connecting";
    }

    if (
        rawStatus === "connecting"
    ) {
        status = "connecting";
    }

    const textMap = {

        connected:
            "Connected",

        qr:
            "Scan QR Code",

        disconnected:
            "Disconnected",

        connecting:
            "Connecting",

        authenticated:
            "Connecting",

        starting:
            "Starting",

        unknown:
            "Unknown"
    };

    const displayText =
        textMap[status] ??
        data.message ??
        rawStatus;

    setWhatsAppStatus(
        status,
        displayText
    );


    /*
     * IMPORTANT:
     *
     * QR is requested for BOTH:
     *
     * QR status
     * and
     * DISCONNECTED status
     *
     * This is the key fix.
     */

    if (
        status === "qr" ||
        status === "disconnected" ||
        status === "connecting"
    ) {

        loadWhatsAppQR();

    } else {

        stopQRRetry();

        hideWhatsAppQR();
    }
}


// ======================================================
// SET WHATSAPP STATUS
// ======================================================

function setWhatsAppStatus(
    status,
    text
) {

    const badge =
        $("whatsappStatusBadge");

    const statusText =
        $("whatsappStatusText");

    const sidebarDot =
        $("sidebarWhatsappDot");

    const sidebarText =
        $("sidebarWhatsappText");

    if (badge) {

        badge.className =
            `status-badge ${status}`;

        badge.textContent =
            text;
    }

    if (statusText) {

        statusText.textContent =
            text;
    }

    if (sidebarDot) {

        sidebarDot.className =
            `status-dot ${status}`;
    }

    if (sidebarText) {

        sidebarText.textContent =
            text;
    }

    const disconnected =
        $("whatsappDisconnected");

    if (disconnected) {

        disconnected.classList.toggle(
            "hidden",
            status !== "disconnected"
        );
    }
}


// ======================================================
// LOAD WHATSAPP QR
// ======================================================

async function loadWhatsAppQR() {

    try {

        const response =
            await fetch(
                "/api/whatsapp/qr",
                {
                    cache: "no-store"
                }
            );

        let data = null;

        try {
            data = await response.json();
        } catch {
            data = null;
        }

        /*
         * QR may not exist during the first
         * few moments after disconnection.
         *
         * Do not show an error toast.
         * Keep checking automatically.
         */

        if (!response.ok) {

            startQRRetry();

            return;
        }

        const qr =
            data?.qr ??
            data?.data ??
            data?.code ??
            null;

        const image =
            $("whatsappQrImage");

        const container =
            $("whatsappQrContainer");

        if (
            !image ||
            !container
        ) {
            return;
        }

        if (!qr) {

            /*
             * QR has not been generated yet.
             */

            startQRRetry();

            return;
        }

        /*
         * Backend normally sends a complete
         * data:image/png;base64,... URL.
         */

        if (
            typeof qr === "string" &&
            qr.startsWith("data:image")
        ) {

            image.src = qr;

        } else {

            /*
             * Fallback for a raw WhatsApp QR string.
             */

            image.src =
                `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
                    qr
                )}`;
        }

        container.classList.remove(
            "hidden"
        );

        stopQRRetry();

        /*
         * Once the QR is displayed,
         * make sure the disconnect box
         * does not cover it.
         */

        const disconnected =
            $("whatsappDisconnected");

        if (disconnected) {

            disconnected.classList.remove(
                "hidden"
            );
        }

    } catch (error) {

        console.error(
            "QR loading error:",
            error
        );

        startQRRetry();
    }
}


// ======================================================
// AUTOMATIC QR RETRY
// ======================================================

function startQRRetry() {

    if (whatsappQRRetryTimer) {
        return;
    }

    whatsappQRRetryTimer =
        setInterval(
            async () => {

                /*
                 * Stop retrying if WhatsApp
                 * has become connected.
                 */

                const badge =
                    $("whatsappStatusBadge");

                const currentText =
                    badge?.textContent
                        ?.toLowerCase() || "";

                if (
                    currentText === "connected"
                ) {

                    stopQRRetry();

                    hideWhatsAppQR();

                    return;
                }

                await loadWhatsAppQR();

            },
            1500
        );
}


function stopQRRetry() {

    if (
        whatsappQRRetryTimer
    ) {

        clearInterval(
            whatsappQRRetryTimer
        );

        whatsappQRRetryTimer =
            null;
    }
}


// ======================================================
// HIDE WHATSAPP QR
// ======================================================

function hideWhatsAppQR() {

    const container =
        $("whatsappQrContainer");

    const image =
        $("whatsappQrImage");

    if (container) {

        container.classList.add(
            "hidden"
        );
    }

    if (image) {

        image.removeAttribute(
            "src"
        );
    }
}
// ======================================================
// MODAL
// ======================================================

function openModal(
    title,
    subtitle,
    body
) {
    const overlay =
        $("modalOverlay");

    if (!overlay) return;

    if ($("modalTitle")) {
        $("modalTitle").textContent =
            title || "";
    }

    if ($("modalSubtitle")) {
        $("modalSubtitle").textContent =
            subtitle || "";
    }

    if ($("modalBody")) {
        $("modalBody").innerHTML =
            body || "";
    }

    overlay.classList.remove(
        "hidden"
    );
}

function closeModal() {
    const overlay =
        $("modalOverlay");

    if (overlay) {
        overlay.classList.add(
            "hidden"
        );
    }

    if ($("modalBody")) {
        $("modalBody").innerHTML = "";
    }
}

// ======================================================
// MANUAL DELIVERY
// ======================================================

function openAddDeliveryModal() {
    const html = `
        <form id="manualDeliveryForm">

            <label>
                Delivered To

                <input
                    id="manualDeliveredTo"
                    type="text"
                    required
                    placeholder="Recipient name"
                >
            </label>

            <label>
                Item

                <select
                    id="manualItem"
                    required
                >

                    <option value="">
                        Select item
                    </option>

                    ${allItems.map(item => `
                        <option
                            value="${escapeHtml(
                                item.name
                            )}"
                        >
                            ${escapeHtml(
                                item.name
                            )}
                        </option>
                    `).join("")}

                </select>

            </label>

            <label>
                Quantity

                <input
                    id="manualQuantity"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                >
            </label>

            <button
                type="submit"
                class="primary-button"
            >
                Add Delivery
            </button>

        </form>
    `;

    openModal(
        "Add Delivery",
        "Create a delivery record",
        html
    );

    $("manualDeliveryForm")
        ?.addEventListener(
            "submit",
            submitManualDelivery
        );
}

async function submitManualDelivery(event) {
    event.preventDefault();

    const deliveredTo =
        $("manualDeliveredTo")
            ?.value
            ?.trim();

    const item =
        $("manualItem")
            ?.value
            ?.trim();

    const quantity =
        Number(
            $("manualQuantity")
                ?.value
        );

    if (
        !deliveredTo ||
        !item ||
        !Number.isFinite(quantity) ||
        quantity <= 0
    ) {
        toast(
            "Enter all delivery details.",
            "error"
        );

        return;
    }

    try {
        await api(
            "/api/whatsapp/delivery",
            {
                method: "POST",

                body:
                    JSON.stringify({
                        deliveredTo,
                        delivered_to:
                            deliveredTo,

                        items: [
                            {
                                item,
                                item_name:
                                    item,
                                quantity
                            }
                        ]
                    })
            }
        );

        closeModal();

        toast(
            "Delivery added.",
            "success"
        );

        await loadOrders();
        await loadDashboard();

    } catch (error) {
        console.error(
            "Manual delivery error:",
            error
        );

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// REFRESH
// ======================================================

async function refreshCurrentSection() {
    try {
        await loadSectionData(
            currentSection
        );

        toast(
            "Updated successfully.",
            "success"
        );

    } catch (error) {
        console.error(
            "Refresh error:",
            error
        );

        toast(
            error.message,
            "error"
        );
    }
}

// ======================================================
// UTILITY
// ======================================================

function extractArray(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (!data) {
        return [];
    }

    if (Array.isArray(data.orders)) {
        return data.orders;
    }

    if (Array.isArray(data.items)) {
        return data.items;
    }

    if (Array.isArray(data.transactions)) {
        return data.transactions;
    }

    if (Array.isArray(data.senders)) {
        return data.senders;
    }

    if (Array.isArray(data.deliveries)) {
        return data.deliveries;
    }

    if (Array.isArray(data.data)) {
        return data.data;
    }

    return [];
}

function statusBadge(status) {
    const value =
        String(
            status ??
            "UNKNOWN"
        ).toUpperCase();

    let cssClass =
        "connecting";

    if (value === "SUCCESS") {
        cssClass = "success";
    }

    if (value === "PARTIAL") {
        cssClass = "partial";
    }

    if (
        value === "REJECTED" ||
        value === "ERROR"
    ) {
        cssClass = "rejected";
    }

    return `
        <span
            class="status-badge ${cssClass}"
        >
            ${escapeHtml(value)}
        </span>
    `;
}

// ======================================================
// EVENT SETUP
// ======================================================

function setupNavigation() {

    document
        .querySelectorAll(".nav-item")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    openSection(
                        button.dataset.section
                    );

                }
            );
        });

    document
        .querySelectorAll(
            "[data-section-target]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    openSection(
                        button.dataset.sectionTarget
                    );

                }
            );
        });
}

function setupButtons() {

    $("refreshButton")
        ?.addEventListener(
            "click",
            refreshCurrentSection
        );

    $("addItemButton")
        ?.addEventListener(
            "click",
            openAddItemModal
        );

    $("addSenderButton")
        ?.addEventListener(
            "click",
            openAddSenderModal
        );

    $("addDeliveryButton")
        ?.addEventListener(
            "click",
            openAddDeliveryModal
        );

    $("modalClose")
        ?.addEventListener(
            "click",
            closeModal
        );

    $("modalOverlay")
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    $("modalOverlay")
                ) {
                    closeModal();
                }

            }
        );

    $("mobileMenuButton")
        ?.addEventListener(
            "click",
            () => {

                const sidebar =
                    $("sidebar");

                if (sidebar) {
                    sidebar.classList.toggle(
                        "open"
                    );
                }

            }
        );
}

function setupSearch() {

    $("deliverySearch")
        ?.addEventListener(
            "input",
            filterOrders
        );

    $("deliveryDateFilter")
        ?.addEventListener(
            "change",
            filterOrders
        );

    $("transactionSearch")
        ?.addEventListener(
            "input",
            filterTransactions
        );
}

// ======================================================
// KEYBOARD
// ======================================================

document.addEventListener(
    "keydown",
    event => {

        if (event.key === "Escape") {
            closeModal();

            $("sidebar")
                ?.classList
                .remove("open");
        }

    }
);

// ======================================================
// INITIALIZE
// ======================================================

async function initializeApp() {

    console.log(
        "Delivery Manager frontend starting..."
    );

    setupNavigation();
    setupButtons();
    setupSearch();

    openSection(
        "dashboard"
    );

    await loadWhatsAppStatus();

    console.log(
        "Delivery Manager frontend ready."
    );
}

// ======================================================
// BACKGROUND REFRESH
// ======================================================

setInterval(
    async () => {

        try {

            await loadWhatsAppStatus();

            if (
                currentSection ===
                "dashboard"
            ) {
                await loadDashboard();
            }

        } catch (error) {

            console.error(
                "Background refresh error:",
                error
            );

        }

    },
    10000
);

// ======================================================
// START
// ======================================================

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeApp
    );

} else {

    initializeApp();

}