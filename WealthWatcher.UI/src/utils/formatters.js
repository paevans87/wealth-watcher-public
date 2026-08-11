export const formatter = new Intl.NumberFormat('en-GB', { 
    style: 'currency', 
    currency: 'GBP', 
    minimumFractionDigits: 2 
});

export function formatCurrencyInput(input) {
    let val = input.value.replace(/,/g, '');
    if (!isNaN(val) && val !== '') {
        input.value = Number(val).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}

export function unformatCurrencyInput(input) {
    let val = input.value.replace(/,/g, '');
    input.value = val;
}

export function setupCurrencyInputs() {
    document.querySelectorAll('.currency-input').forEach(input => {
        // remove existing to avoid duplicate firing if called multiple times
        input.removeEventListener('blur', handleBlur);
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('input', handleInput);
        
        input.addEventListener('blur', handleBlur);
        input.addEventListener('focus', handleFocus);
        input.addEventListener('input', handleInput);
        
        // Add inputmode if missing
        if (!input.hasAttribute('inputmode')) {
            input.setAttribute('inputmode', 'decimal');
        }
    });
}

function handleInput(e) {
    // Strip any characters that aren't digits, commas, periods, or minus signs
    e.target.value = e.target.value.replace(/[^\d.,-]/g, '');
}

function handleBlur(e) {
    formatCurrencyInput(e.target);
}

function handleFocus(e) {
    unformatCurrencyInput(e.target);
}
