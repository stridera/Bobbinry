import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { bobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'

const viewsPlugin: FastifyPluginAsync = async (fastify) => {
    // Serve view HTML for a specific bobbin view
    fastify.get<{
        Params: { bobbinId: string; viewId: string }
        Querystring: { projectId: string }
    }>('/views/:bobbinId/:viewId', async (request, reply) => {
        try {
            const { bobbinId, viewId } = request.params
            const { projectId } = request.query

            // Verify bobbin is installed in project
            const installation = await db
                .select()
                .from(bobbinsInstalled)
                .where(and(
                    eq(bobbinsInstalled.projectId, projectId),
                    eq(bobbinsInstalled.bobbinId, bobbinId),
                    eq(bobbinsInstalled.enabled, true)
                ))
                .limit(1)

            if (installation.length === 0) {
                return reply.status(404).send({ error: 'Bobbin not found or not installed' })
            }

            const manifest = installation[0]!.manifestJson as any
            const view = manifest.ui?.views?.find((v: any) => v.id === viewId)

            if (!view) {
                return reply.status(404).send({ error: 'View not found in manifest' })
            }

            // Generate view HTML based on view type
            const viewHtml = generateViewHtml(view, manifest, projectId, bobbinId)

            return reply.type('text/html').send(viewHtml)
        } catch (error) {
            fastify.log.error(error)
            return reply.status(500).send({ error: 'Failed to serve view' })
        }
    })

    // Serve view assets (CSS, JS) - placeholder for now
    fastify.get<{
        Params: { bobbinId: string; asset: string }
    }>('/views/:bobbinId/assets/:asset', async (_request, reply) => {
        // In a full implementation, this would serve static assets
        // For now, return a 404
        return reply.status(404).send({ error: 'Asset not found' })
    })
}

function generateViewHtml(view: any, manifest: any, projectId: string, bobbinId: string): string {
    const baseHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${view.id} - ${manifest.name}</title>
    <style>
        body {
            margin: 0;
            padding: 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: white;
            color: #1f2937;
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 200px;
            color: #6b7280;
        }
        .error {
            padding: 16px;
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 8px;
            color: #dc2626;
        }
        .view-header {
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 16px;
            margin-bottom: 24px;
        }
        .view-title {
            font-size: 24px;
            font-weight: 600;
            margin: 0;
        }
        .view-subtitle {
            font-size: 14px;
            color: #6b7280;
            margin: 4px 0 0 0;
        }
        .placeholder-content {
            background: #f9fafb;
            border: 2px dashed #d1d5db;
            border-radius: 8px;
            padding: 48px 24px;
            text-align: center;
            color: #6b7280;
        }
        .tree-view {
            background: white;
        }
        .tree-item {
            padding: 8px 12px;
            border-bottom: 1px solid #f3f4f6;
            cursor: pointer;
        }
        .tree-item:hover {
            background: #f9fafb;
        }
        .editor-container {
            display: flex;
            gap: 16px;
            height: calc(100vh - 120px);
        }
        .editor-main {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .editor-textarea {
            flex: 1;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 16px;
            font-family: 'Monaco', 'Menlo', monospace;
            resize: none;
            outline: none;
        }
        .editor-sidebar {
            width: 250px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 16px;
        }
        .sidebar-section {
            margin-bottom: 24px;
        }
        .sidebar-label {
            font-weight: 600;
            margin-bottom: 8px;
            display: block;
        }
        .sidebar-input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            font-size: 14px;
        }
        .create-button {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin: 4px;
        }
        .create-button:hover {
            background: #2563eb;
        }
    </style>
</head>
<body>
    <div class="view-header">
        <h1 class="view-title">${view.id}</h1>
        <p class="view-subtitle">${manifest.name} • ${view.type} view</p>
    </div>

    <div id="view-content">
        <div class="loading">Loading ${view.type} view...</div>
    </div>

    <script>
        // View-specific JavaScript will be injected here
        ${getViewScript(view, manifest, projectId, bobbinId)}
    </script>
</body>
</html>`

    return baseHtml
}

function getViewScript(view: any, _manifest: any, _projectId: string, bobbinId: string): string {
    const baseScript = `
    // Global state
    let viewContext = null;
    let apiRequestId = 0;
    let pendingRequests = new Map();

    // Signal that iframe script is loaded and ready to receive messages
    postToParent({
        type: 'VIEW_SCRIPT_LOADED',
        timestamp: Date.now(),
        payload: {}
    });

    // Message handling with parent
    window.addEventListener('message', (event) => {
        const { type, payload, requestId } = event.data;

        switch (type) {
            case 'INIT_CONTEXT':
                viewContext = payload;
                initializeView();
                break;
            case 'API_RESPONSE':
                handleApiResponse(payload, requestId);
                break;
        }
    });

    function postToParent(message) {
        window.parent.postMessage(message, '*');
    }

    function makeApiRequest(method, collection, data = {}) {
        return new Promise((resolve, reject) => {
            const requestId = (++apiRequestId).toString();
            pendingRequests.set(requestId, { resolve, reject });

            const messageType = method === 'GET' ? 'ENTITY_QUERY' :
                               method === 'POST' ? 'ENTITY_CREATE' :
                               method === 'PUT' ? 'ENTITY_UPDATE' : 'ENTITY_DELETE';

            const payload = method === 'GET' ? {
                collection,
                filters: data.filters,
                sort: data.sort,
                limit: data.limit || 50,
                offset: data.offset || 0
            } : {
                collection,
                id: data.id,
                data: data.data || data,
                validate: true
            };

            postToParent({
                type: messageType,
                requestId,
                timestamp: Date.now(),
                payload
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (pendingRequests.has(requestId)) {
                    pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    function handleApiResponse(payload, requestId) {
        const request = pendingRequests.get(requestId);
        if (request) {
            pendingRequests.delete(requestId);
            if (payload.success) {
                request.resolve(payload.data);
            } else {
                request.reject(new Error(payload.error));
            }
        }
    }

    function setError(message) {
        document.getElementById('view-content').innerHTML =
            '<div class="error">Error: ' + message + '</div>';
    }

    // Initialize view when context is received
    function initializeView() {
        try {
            ${getViewTypeScript(view)}

            // Signal that view is ready with capabilities
            postToParent({
                type: 'VIEW_READY',
                timestamp: Date.now(),
                payload: {
                    viewId: '${view.id}',
                    bobbinId: '${bobbinId}',
                    capabilities: ['entity-crud', 'offline-cache', 'theme-aware']
                }
            });
        } catch (error) {
            console.error('View initialization failed:', error);
            postToParent({
                type: 'VIEW_ERROR',
                timestamp: Date.now(),
                payload: {
                    error: error.message,
                    stack: error.stack,
                    recoverable: true
                }
            });
        }
    }
  `

    return baseScript
}

function getViewTypeScript(view: any): string {
    // Convert source to collection name (handles both singular and plural forms)
    const sourceName = view.source || 'items';
    const source = sourceName.toLowerCase().endsWith('s') 
        ? sourceName.toLowerCase() 
        : sourceName.toLowerCase() + 's';

    switch (view.type) {
        case 'tree':
            return `
        async function loadTreeData() {
            try {
                const data = await makeApiRequest('GET', '${source}', {
                    filters: {},
                    sort: [{ field: 'order', direction: 'asc' }],
                    limit: 100
                });
                renderTree(data);
            } catch (error) {
                setError('Failed to load tree data: ' + error.message);
            }
        }

        function renderTree(data) {
            const content = document.getElementById('view-content');
            if (!data || !Array.isArray(data.entities)) {
                content.innerHTML = '<div class="placeholder-content">No ${source} items found</div>';
                return;
            }

            let html = '<div class="tree-view">';
            html += '<div style="margin-bottom: 16px;">';
            html += '<button class="create-button" onclick="createItem()">Create ${source}</button>';
            html += '</div>';

            data.entities.forEach(item => {
                html += '<div class="tree-item" onclick="selectItem(\\'' + item.id + '\\')"><strong>' + (item.title || item.name || 'Untitled') + '</strong>';
                if (item.synopsis || item.description) {
                    html += '<div style="font-size: 12px; color: #6b7280; margin-top: 4px;">' + (item.synopsis || item.description) + '</div>';
                }
                html += '</div>';
            });
            html += '</div>';

            content.innerHTML = html;
        }

        window.selectItem = function(itemId) {
            console.log('Selected item:', itemId);
        }

        window.createItem = function() {
            const title = window.prompt('Enter title for new ${source}:');
            if (title) {
                makeApiRequest('POST', '${source}', {
                    data: { title, order: Date.now() }
                }).then(() => {
                    loadTreeData();
                }).catch(error => {
                    setError('Failed to create item: ' + error.message);
                });
            }
        }

        loadTreeData();
      `;

        case 'editor':
            const fieldName = view.layout?.field || 'body';
            return `
        let currentItem = null;

        async function loadEditorData() {
            try {
                const data = await makeApiRequest('GET', '${source}', {
                    filters: {},
                    sort: [{ field: 'created_at', direction: 'desc' }],
                    limit: 1
                });

                if (data && data.entities && data.entities.length > 0) {
                    currentItem = data.entities[0];
                    renderEditor(currentItem);
                } else {
                    renderEmptyEditor();
                }
            } catch (error) {
                setError('Failed to load editor data: ' + error.message);
            }
        }

        function renderEditor(item) {
            const content = document.getElementById('view-content');
            const fieldValue = item['${fieldName}'] || '';

            content.innerHTML =
                '<div class="editor-container">' +
                    '<div class="editor-main">' +
                        '<div style="margin-bottom: 16px;"><strong>' + (item.title || 'Untitled') + '</strong><button class="create-button" onclick="saveItem()" style="float: right;">Save</button></div>' +
                        '<textarea class="editor-textarea" id="editor-field" placeholder="Start writing...">' + fieldValue + '</textarea>' +
                    '</div>' +
                    '<div class="editor-sidebar">' +
                        '<div class="sidebar-section"><label class="sidebar-label">Title</label><input type="text" class="sidebar-input" id="title-field" value="' + (item.title || '') + '" /></div>' +
                        '<div class="sidebar-section"><label class="sidebar-label">Status</label><select class="sidebar-input" id="status-field"><option value="draft"' + (item.status === 'draft' ? ' selected' : '') + '>Draft</option><option value="revised"' + (item.status === 'revised' ? ' selected' : '') + '>Revised</option><option value="final"' + (item.status === 'final' ? ' selected' : '') + '>Final</option></select></div>' +
                    '</div>' +
                '</div>';
        }

        function renderEmptyEditor() {
            const content = document.getElementById('view-content');
            content.innerHTML = '<div class="placeholder-content">' +
                '<p>No ${source} items found.</p>' +
                '<div id="create-form" style="display: none; margin-top: 16px;">' +
                    '<input type="text" id="new-item-title" placeholder="Enter title..." style="padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; margin-right: 8px; width: 250px;" />' +
                    '<button class="create-button" onclick="submitNewItem()">Create</button>' +
                    '<button class="create-button" onclick="cancelCreate()" style="background: #6b7280;">Cancel</button>' +
                '</div>' +
                '<button id="show-create-btn" class="create-button" onclick="showCreateForm()">Create First ${source}</button>' +
                '</div>';
        }

        window.saveItem = function() {
            if (!currentItem) return;

            const updatedData = {
                id: currentItem.id,
                '${fieldName}': document.getElementById('editor-field').value,
                title: document.getElementById('title-field').value,
                status: document.getElementById('status-field').value
            };

            makeApiRequest('PUT', '${source}', {
                id: currentItem.id,
                data: updatedData
            }).then(() => {
                // Show success feedback in UI
                const content = document.getElementById('view-content');
                const saveBtn = content.querySelector('button.create-button');
                if (saveBtn) {
                    const originalText = saveBtn.textContent;
                    saveBtn.textContent = '✓ Saved';
                    saveBtn.style.background = '#10b981';
                    setTimeout(() => {
                        saveBtn.textContent = originalText;
                        saveBtn.style.background = '';
                    }, 2000);
                }
            }).catch(error => {
                setError('Save failed: ' + error.message);
            });
        }

        window.showCreateForm = function() {
            document.getElementById('create-form').style.display = 'block';
            document.getElementById('show-create-btn').style.display = 'none';
            document.getElementById('new-item-title').focus();
        }

        window.cancelCreate = function() {
            document.getElementById('create-form').style.display = 'none';
            document.getElementById('show-create-btn').style.display = 'inline-block';
            document.getElementById('new-item-title').value = '';
        }

        window.submitNewItem = function() {
            const title = document.getElementById('new-item-title').value.trim();
            if (!title) return;

            makeApiRequest('POST', '${source}', {
                data: { title: title, '${fieldName}': '' }
            }).then(result => {
                currentItem = result;
                renderEditor(currentItem);
            }).catch(error => {
                setError('Creation failed: ' + error.message);
            });
        }

        // Handle Enter key in title input
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.id === 'new-item-title') {
                submitNewItem();
            }
        });

        loadEditorData();
      `;

        default:
            return `
        document.getElementById('view-content').innerHTML =
            '<div class="placeholder-content">View type "${view.type}" not yet implemented</div>';
      `;
    }
}

export default viewsPlugin