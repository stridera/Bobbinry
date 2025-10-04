import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
/**
 * Theme-aware Panel component for sidebars and sections
 *
 * @example
 * <Panel title="Statistics">
 *   <div>Panel content</div>
 * </Panel>
 */
export function Panel({ title, children, className = '', collapsible = false, defaultCollapsed = false }) {
    const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);
    const toggleCollapse = () => {
        if (collapsible) {
            setIsCollapsed(!isCollapsed);
        }
    };
    return (_jsxs("div", { className: `bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`, children: [title && (_jsx("div", { className: `px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 ${collapsible ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''}`, onClick: toggleCollapse, children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 dark:text-gray-300", children: title }), collapsible && (_jsx("svg", { className: `w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }) }))] }) })), (!collapsible || !isCollapsed) && (_jsx("div", { className: "p-4", children: children }))] }));
}
//# sourceMappingURL=Panel.js.map