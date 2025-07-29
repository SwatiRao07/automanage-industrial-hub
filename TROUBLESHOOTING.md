# Google Sign-In Troubleshooting

## Common Issues & Solutions

### 1. "Sign-in was cancelled"
**Cause**: User closed the Google popup
**Solution**: This is normal behavior. Just click "Sign in with Google" again.

### 2. "Pop-up was blocked"
**Cause**: Browser blocked the Google popup
**Solution**: 
- Allow pop-ups for localhost:8080
- Try clicking the popup blocker icon in your browser
- Or use a different browser

### 3. "Sign-in failed"
**Cause**: Firebase configuration issues
**Solution**:
1. Check your `.env` file has correct Firebase values
2. Enable Google Authentication in Firebase Console
3. Verify your domain is authorized

### 4. No account selection prompt
**Cause**: Browser remembers previous login
**Solution**: 
- The app is configured to force account selection
- Clear browser cookies/cache
- Try incognito/private mode

### 5. "auth/unauthorized-domain"
**Cause**: Domain not authorized in Firebase
**Solution**:
1. Go to Firebase Console → Authentication → Settings
2. Add `localhost` to authorized domains
3. For production, add your domain

## Setup Checklist

- [ ] Firebase project created
- [ ] Google Authentication enabled
- [ ] `.env` file with correct values
- [ ] Domain authorized in Firebase
- [ ] Pop-ups allowed in browser

## Testing Steps

1. **Clear browser data** (cookies, cache)
2. **Open incognito/private window**
3. **Go to http://localhost:8080**
4. **Click "Sign in with Google"**
5. **Select your Google account**
6. **Should redirect to dashboard**

## Environment Variables

Make sure your `.env` file has all required values:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

## Firebase Console Setup

1. **Enable Google Provider**:
   - Authentication → Sign-in method → Google → Enable

2. **Authorize Domains**:
   - Authentication → Settings → Authorized domains
   - Add: `localhost`

3. **Check Project Settings**:
   - Project Settings → General → Your apps
   - Verify web app configuration 