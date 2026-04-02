# Shein Auto-Buy Tool

Automated purchasing tool for Shein using Multilogin X + Playwright.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the server**
   ```bash
   npm start
   ```

3. Open browser at: [http://localhost:3000](http://localhost:3000)

## Configuration

### Settings Tab
- Enter your **Multilogin account email & password**
- Enter your **Folder ID** (from Multilogin DevTools or Postman)
- Set **Concurrency** (3–5 recommended)
- Save Settings

### Profiles Tab
- Add each Multilogin **Profile ID** and give it a label
- Profiles are assigned to rows in round-robin order

### Upload Tab
- Upload `.xlsx` file with columns:
  | Column | Description |
  |--------|-------------|
  | `product_url` | Full Shein product URL |
  | `color` | Color name (e.g. `Black`) |
  | `size` | Size name (e.g. `L`) |
  | `quantity` | Number of items |
  | `shipping_address` | Name, Address, Phone, ZIP separated by newline |

### Dashboard Tab
- Click **Start Batch** to begin
- Monitor progress in real-time per profile

## Project Structure

```
Tool-Buy-Shein/
├── server.js                  # Express + Socket.io server
├── src/
│   ├── services/
│   │   ├── multilogin.js      # Multilogin X API (signin, start/stop profile)
│   │   └── shein-automation.js # Playwright automation core
│   ├── workers/
│   │   └── batch-runner.js    # Queue-based concurrent runner
│   └── utils/
│       ├── excel-parser.js    # .xlsx reader
│       └── address-parser.js  # shipping_address parser
├── public/
│   ├── index.html             # Dashboard UI
│   ├── app.js                 # Frontend logic
│   └── style.css              # Custom styles
└── uploads/                   # Temporary Excel uploads
```
