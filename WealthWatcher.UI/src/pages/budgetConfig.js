export const BUDGET_CATEGORY_CONFIG = Object.freeze({
    income: Object.freeze({
        label: 'Income Sources',
        itemLabel: 'Income',
        namePlaceholder: 'e.g. Salary',
        color: '#06b6d4',
        action: 'addBudgetIncome'
    }),
    bills: Object.freeze({
        label: 'Bills (Needs)',
        itemLabel: 'Bill',
        namePlaceholder: 'e.g. Rent',
        color: '#ef4444',
        action: 'addBudgetBills'
    }),
    savings: Object.freeze({
        label: 'Savings (Future)',
        itemLabel: 'Saving',
        namePlaceholder: 'e.g. Emergency Fund',
        color: '#10b981',
        action: 'addBudgetSavings'
    }),
    spend: Object.freeze({
        label: 'Spend (Wants)',
        itemLabel: 'Spend',
        namePlaceholder: 'e.g. Groceries',
        color: '#8b5cf6',
        action: 'addBudgetSpend'
    })
});

export const BUDGET_CATEGORIES = Object.freeze(Object.keys(BUDGET_CATEGORY_CONFIG));
