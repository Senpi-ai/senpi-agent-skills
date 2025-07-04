## Stop Loss Order Functionality

Users can place **stop loss orders** on tokens they currently hold in their wallet to prevent financial losses from price drops. This feature is intended **only for loss protection** and does **not support profit-taking conditions**.

### ✅ Supported Use Cases

1. **Percentage-Based Stop Loss**
    
    Sell the token if its price drops by a specified percentage.
    
    *Example*: “Sell my token if the price drops by **10%**.”
    
2. **Absolute Price Drop**
    
    Sell if the token’s price falls below a certain dollar value.
    
    *Example*: “Sell if the price drops from **$10 to $8**.”
    
3. **Loss in Value Per Unit**
    
    Trigger a sale based on the total dollar loss of the holdings.
    
    *Example*: “Sell all my tokens if they lose **$1 in value**.”
    
4. **Tiered Stop Loss Conditions**
    
    Sell different portions of the token at different loss levels.
    
    *Example*:
    
    - Sell **10%** if the price drops by **20%**
    - Sell another **20%** at **30% loss**
    - Sell the remaining if it drops by **50%**

### ❌ Unsupported Use Cases

- **Tokens not held in wallet**
    
    Users cannot place stop loss orders on tokens they do not already hold.
    
    *Invalid*: “Buy token X and set a stop loss at 12%.”
    
- **Profit-taking conditions**
    
    This feature does not support selling on gains.
    
    *Invalid*: “Sell my token if it gains 20%.”
    
    → Use a separate **limit order** plugin for this functionality.
    

### 🧠 Token Selection Flexibility

Users can specify tokens for stop loss in multiple ways:

- `$[token_name|token_address]`
- Only by token name(s)
- Only by token address(es)
- A combination of names and/or addresses
- Use keywords like **all**, **any**, or **top N tokens by balance**

*Examples*:

- “Set a 10% stop loss on **$USDC** and **$ETH**.”
- “Set a 10% stop loss on **all my tokens**.”
- “Set a stop loss on my **top 2 tokens by balance**.”