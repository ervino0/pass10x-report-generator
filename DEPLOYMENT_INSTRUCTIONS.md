# Pass10x Report Generator - OCR Deployment Guide

This guide will help you set up the OCR functionality for license plate scanning using Cloudflare Workers and Gemini Vision API.

## Overview

The OCR feature works as follows:
1. **Cloudflare Worker** - Securely stores your Gemini API key in the cloud
2. **Chrome Extension** - Calls the worker to get the API key, then uses Gemini Vision to scan images
3. **Automatic Sync** - Settings sync across all your Chrome browsers via Chrome Sync Storage

---

## Part 1: Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Get API Key"** or **"Create API Key"**
4. Copy the API key (starts with `AIza...`)
5. Keep this key safe - you'll need it in Part 2

**Note**: The free tier includes generous usage limits for personal use.

---

## Part 2: Deploy Cloudflare Worker

### Step 1: Create Cloudflare Account

1. Go to [Cloudflare Workers](https://workers.cloudflare.com/)
2. Click **"Sign Up"** (it's free!)
3. Verify your email

### Step 2: Create a New Worker

1. In your Cloudflare dashboard, go to **Workers & Pages**
2. Click **"Create Worker"**
3. Give it a name (e.g., `pass10x-ocr-key`)
4. Click **"Deploy"**
5. Click **"Edit Code"**

### Step 3: Replace Worker Code

1. Delete all the existing code in the editor
2. Copy the entire contents of `cloudflare-worker.js` from this project
3. Paste it into the Cloudflare editor
4. Click **"Deploy"**

### Step 4: Add Environment Secrets

1. Go back to your worker's page
2. Click on **"Settings"** tab
3. Scroll to **"Environment Variables"**
4. Click **"Add variable"**
5. Add the following TWO secrets:

   **Secret 1: GEMINI_API_KEY**
   - Name: `GEMINI_API_KEY`
   - Type: **Secret** (check the "Encrypt" checkbox)
   - Value: Paste your Gemini API key from Part 1
   - Click **"Add variable"**

   **Secret 2: AUTH_SECRET**
   - Name: `AUTH_SECRET`
   - Type: **Secret** (check the "Encrypt" checkbox)
   - Value: Generate a strong random token (see below)
   - Click **"Add variable"**

6. Click **"Save and Deploy"**

#### How to Generate AUTH_SECRET

Run this in your terminal or use an online generator:

```bash
# Option 1: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 2: Using OpenSSL
openssl rand -hex 32

# Option 3: Online
# Visit: https://www.random.org/strings/ and generate a 64-character hex string
```

**IMPORTANT**: Save this `AUTH_SECRET` token somewhere safe - you'll need it to configure the Chrome extension!

### Step 5: Get Your Worker URL

1. After deployment, you'll see a URL like:
   ```
   https://pass10x-ocr-key.your-subdomain.workers.dev
   ```
2. Copy this URL - you'll need it in Part 3

---

## Part 3: Configure Chrome Extension

### Step 1: Update Extension

1. Make sure you've updated all files in this project:
   - `popup.html` ✅
   - `popup.js` ✅
   - `manifest.json` ✅
   - `cloudflare-worker.js` ✅

### Step 2: Reload Extension

1. Open Chrome and go to `chrome://extensions/`
2. Find **"Pass 10x Report Generator"**
3. Click the **Reload** icon (🔄)

### Step 3: Configure OCR Settings

1. Click the extension icon to open the popup
2. Click the **⚙️ Settings** button
3. Fill in the two fields:

   **Cloudflare Worker URL**:
   ```
   https://pass10x-ocr-key.your-subdomain.workers.dev
   ```
   (Use the URL from Part 2, Step 5)

   **Authentication Token**:
   ```
   [paste your AUTH_SECRET from Part 2, Step 4]
   ```

4. Click **"💾 Save"**

**Note**: These settings are stored in Chrome Sync Storage, so they'll automatically sync to all your Chrome browsers where you're logged in!

---

## Part 4: Test OCR Functionality

### Test 1: Scan an Image

1. Open the extension on the Pass10x website
2. Click **"📷 Scan License Plates from Image"**
3. Select an image containing handwritten or printed license plates
4. Wait for OCR processing
5. Verify the detected plates in the modal
6. Click **"✅ Correct - Check Plates"** to proceed

### Test 2: Verify Plate Normalization

The extension automatically removes spaces from license plates. Test with BC formats:

```
Input:  ABC 123
Output: ABC123

Input:  A00 0AA
Output: A000AA
```

All plates are normalized before checking against Pass10x.

---

## Security Notes

✅ **API Key Security**:
- Your Gemini API key is stored as an encrypted secret in Cloudflare
- It is NEVER stored in the Chrome extension or local files
- The extension only fetches it when needed via authenticated requests

✅ **Auth Token Security**:
- Only you know the `AUTH_SECRET` token
- The Cloudflare Worker rejects all requests without the correct token
- Even if someone finds your Worker URL, they can't get your API key

✅ **Chrome Sync**:
- Settings sync across your Chrome browsers automatically
- Chrome encrypts synced data

---

## Troubleshooting

### "OCR not configured" Error

**Solution**: Go to Settings (⚙️) and make sure both fields are filled:
- Cloudflare Worker URL
- Authentication Token

### "Authentication failed" Error

**Solution**: Your `AUTH_SECRET` token doesn't match. Check:
1. Did you copy the exact token from Cloudflare Worker secrets?
2. No extra spaces or characters?
3. Try regenerating the token and updating both places

### "Failed to fetch API key" Error

**Solution**: Check your Cloudflare Worker:
1. Is it deployed and running?
2. Are both secrets (`GEMINI_API_KEY` and `AUTH_SECRET`) set?
3. Try visiting the worker URL in a browser - you should see "Unauthorized"

### "No license plates detected" Error

**Solution**:
- Make sure the image is clear and contains visible license plates
- Try a different image or adjust lighting/angle
- Gemini Vision works best with clear, well-lit images

### OCR Returns Wrong Plates

**Solution**:
- Use the **"✏️ Edit Plates"** button in the verification modal
- Manually correct the plates before checking
- Consider using a clearer image for better OCR accuracy

---

## Cost Breakdown

### Cloudflare Workers
- ✅ **Free Tier**: 100,000 requests/day
- You'll likely use <100 requests/day
- **Cost**: $0/month

### Gemini API
- ✅ **Free Tier**: 1,500 requests/day (Gemini 2.0 Flash)
- Each OCR scan = 1 request
- **Cost**: $0/month for normal usage

**Total Monthly Cost**: **$0** 🎉

---

## Features Summary

✅ **OCR License Plate Scanning** - Extract plates from images using Gemini Vision
✅ **Automatic Plate Normalization** - Removes spaces from all BC plate formats
✅ **Verification Modal** - Review and edit detected plates before checking
✅ **Secure API Key Storage** - API key stored in Cloudflare, not locally
✅ **Chrome Sync** - Settings sync across all your Chrome browsers
✅ **Free Forever** - No costs for personal use

---

## Support

If you encounter issues:

1. Check the browser console for errors (F12 → Console tab)
2. Verify all settings in the ⚙️ Settings modal
3. Test the Cloudflare Worker independently
4. Review the Cloudflare Worker logs in your dashboard

---

## File Reference

- `cloudflare-worker.js` - Deploy this to Cloudflare Workers
- `popup.html` - Extension UI with OCR button and modals
- `popup.js` - OCR logic and Gemini Vision integration
- `manifest.json` - Chrome extension configuration
- `DEPLOYMENT_INSTRUCTIONS.md` - This file

---

**Ready to Scan!** 📷✨
