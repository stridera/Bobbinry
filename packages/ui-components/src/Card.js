import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Theme-aware Card component
 *
 * @example
 * <Card title="My Item" subtitle="Description">
 *   <p>Card content here</p>
 * </Card>
 */
export function Card({ title, subtitle, children, headerActions, className = '', onClick, hover = false }) {
    const baseClasses = 'border rounded-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
    const interactiveClasses = onClick || hover
        ? 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-colors'
        : '';
    const classes = [baseClasses, interactiveClasses, className]
        .filter(Boolean)
        .join(' ');
    const CardComponent = onClick ? 'button' : 'div';
    const cardProps = onClick ? { onClick, type: 'button' } : {};
    return (_jsxs(CardComponent, { className: classes, ...cardProps, children: [(title || subtitle || headerActions) && (_jsxs("div", { className: "flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700", children: [_jsxs("div", { className: "flex-1", children: [title && (_jsx("h3", { className: "text-base font-semibold text-gray-900 dark:text-gray-100", children: title })), subtitle && (_jsx("p", { className: "text-sm text-gray-600 dark:text-gray-400 mt-1", children: subtitle }))] }), headerActions && (_jsx("div", { className: "ml-4 flex-shrink-0", children: headerActions }))] })), children && (_jsx("div", { className: "p-4", children: children }))] }));
}
//# sourceMappingURL=Card.js.map