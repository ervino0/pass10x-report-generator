# OCR Feature Deployment Guide

This guide will walk you through setting up the Gemini Vision OCR feature for the Pass10x Report Generator Chrome extension.

## Overview

The OCR feature uses:
- **Cloudflare Workers** (free tier) - Securely stores your Gemini API key
- **Google Gemini Vision API** (gemini-3-flash-preview) - Performs OCR on license plate images
- **Chrome Sync Storage** - Stores your Worker URL and auth token across all your Chrome browsers

## Step 1: Get a Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Get API Key"** or **"Create API Key"**
4. Copy the API key (starts with `AIza...`)
5. **Keep this key secure** - you'll add it to Cloudflare Workers in the next step

## Step 2: Deploy the Cloudflare Worker

### 2.1 Create a Cloudflare Account

1. Go to [Cloudflare](https://dash.cloudflare.com/sign-up)
2. Sign up for a free account
3. Verify your email

### 2.2 Create a Worker

1. In the Cloudflare Dashboard, go to **Workers & Pages**
2. Click **Create Application**
3. Select **Create Worker**
4. Give it a name (e.g., `pass10x-ocr-key`)
5. Click **Deploy**

### 2.3 Add the Worker Code

1. After deployment, click **Edit Code**
2. **Delete all existing code** in the editor
3. Open the file `cloudflare-worker.js` from your extension folder
4. **Copy all the code** from `cloudflare-worker.js`
5. **Paste it** into the Cloudflare Worker editor
6. Click **Save and Deploy**

### 2.4 Add Environment Variables (Secrets)

1. In the Worker dashboard, go to **Settings** → **Variables**
2. Under **Environment Variables**, click **Add variable**

**Add these two secrets:**

#### Secret 1: GEMINI_API_KEY
- Variable name: `GEMINI_API_KEY`
- Value: Your Gemini API key from Step 1 (e.g., `AIzaSy...`)
- Check **"Encrypt"**
- Click **Save**

#### Secret 2: AUTH_SECRET
- Variable name: `AUTH_SECRET`
- Value: Generate a strong random string (you can use a password generator)
  - Example: `kJ8n2mP9xQ4wR7tY5uE3vB6cN1aL0zX`
  - **Save this somewhere secure** - you'll need it in Step 3
- Check **"Encrypt"**
- Click **Save**

3. Click **Deploy** to apply the changes

### 2.5 Get Your Worker URL

1. In the Worker dashboard, you'll see your Worker URL
2. It will look like: `https://pass10x-ocr-key.your-subdomain.workers.dev`
3. **Copy this URL** - you'll need it in Step 3

## Step 3: Configure the Chrome Extension

### 3.1 Load the Extension (if not already loaded)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the folder: `/Users/ervin/Documents/Antigravity Projects/Pass10x Report Generator`

### 3.2 Configure OCR Settings

1. Click the extension icon in your Chrome toolbar
2. Switch to **Check Plates** mode
3. Click the **⚙️ Settings** button
4. Enter:
   - **Cloudflare Worker URL**: The URL from Step 2.5
   - **Authentication Token**: The `AUTH_SECRET` value you created in Step 2.4
5. Click **💾 Save**

**Note:** These settings are stored in Chrome Sync Storage, so they'll automatically sync to all your Chrome browsers where you're logged in.

## Step 4: Test the OCR Feature

### 4.1 Test with an Image

1. Open the Pass10x Report Generator extension
2. Switch to **Check Plates** mode
3. Click **📷 Scan License Plates from Image**
4. Select an image containing license plates
5. The extension will:
   - Show an image preview
   - Scan the image using Gemini Vision
   - Display detected plates in a verification modal
6. Review the detected plates:
   - Click **✅ Correct - Check Plates** to proceed with checking
   - Click **✏️ Edit Plates** to manually correct any errors

### 4.2 What Happens Behind the Scenes

1. Extension calls your Cloudflare Worker with your auth token
2. Worker validates the token and returns the Gemini API key
3. Extension sends the image to Gemini Vision API
4. Gemini returns detected license plate numbers
5. Extension normalizes plates (removes spaces) and shows verification modal
6. User confirms and plates are checked against Pass10x database

## Security Features

✅ **API Key Never Stored Locally** - Your Gemini API key is only in Cloudflare Workers
✅ **Authentication Required** - Only requests with your secret token can access the key
✅ **Chrome Sync Encryption** - Settings are encrypted by Chrome when synced
✅ **No Logging** - The Worker doesn't log any requests or data
✅ **CORS Protected** - Worker only accepts requests with proper authentication

## Troubleshooting

### "OCR not configured" Error
- Make sure you've completed Step 3.2 and saved your settings
- Verify the Worker URL is correct (starts with `https://` and ends with `.workers.dev`)

### "Authentication failed" Error
- Check that your `AUTH_SECRET` in Step 3.2 matches the one in Cloudflare Worker settings
- Make sure you copied it exactly (no extra spaces)

### "No license plates detected" Error
- Make sure the image contains visible license plates
- Try a clearer/higher resolution image
- Ensure plates are not too small or blurry

### "Gemini API error: 401" or "403"
- Your Gemini API key may be invalid or expired
- Check your API key at [Google AI Studio](https://aistudio.google.com/app/apikey)
- Update the `GEMINI_API_KEY` secret in Cloudflare Workers

### "Gemini API error: 429"
- You've exceeded the free tier rate limit
- Wait a few minutes and try again
- Consider upgrading to a paid tier if needed

## Cost Information

### Cloudflare Workers
- **Free Tier**: 100,000 requests/day
- **Cost**: $0 (well within free tier for personal use)

### Google Gemini API
- **Free Tier**: 1,500 requests/day (as of 2026)
- **Cost**: $0 for typical usage
- Check current pricing at [Google AI Pricing](https://ai.google.dev/pricing)

## Updating the Worker

If you need to update the Worker code:

1. Go to your Worker in Cloudflare Dashboard
2. Click **Edit Code**
3. Update the code
4. Click **Save and Deploy**

Your environment variables (API key and auth token) will remain unchanged.

## Support

If you encounter issues:
1. Check the browser console (F12) for error messages
2. Check the Cloudflare Worker logs in the dashboard
3. Verify all settings are correct

## License Plate Format Normalization

The extension automatically removes all spaces from detected plates, so these BC formats are all handled correctly:

- Standard Passenger: `A00 0AA` → `A000AA`
- Commercial Truck: `0AB 000` → `0AB000`
- Farm Truck: `000 00A` → `00000A`
- Motorcycle: `000 0A0` → `0000A0`
- Veteran: `0000 VA` → `0000VA`
- Ham Radio: `VE7 AAA` → `VE7AAA`
- And all other formats with spaces

No manual formatting needed!
