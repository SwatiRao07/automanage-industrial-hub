# Google OAuth Setup Guide

## Quick Setup

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Authentication** → **Sign-in method**
4. Enable **Google** provider
5. Go to **Project Settings** → **General** → **Your apps**
6. Copy your Firebase config values

### 2. Environment Variables

Create a `.env` file in your project root:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

### 3. Test the Application

```bash
npm run dev
```

Visit http://localhost:8080 and click "Sign in with Google"

## Features

- ✅ Clean, minimal login interface
- ✅ Google OAuth 2.0 authentication
- ✅ Account selection prompt
- ✅ Automatic redirect after login
- ✅ User profile in header
- ✅ Sign out functionality
- ✅ Error handling
- ✅ Loading states

## Files Created

- `src/hooks/useAuth.ts` - Authentication hook
- `src/components/Login.tsx` - Login component
- `src/components/ProtectedRoute.tsx` - Route protection
- `src/components/UserProfile.tsx` - User profile
- Updated `src/App.tsx` - Main app with auth
- Updated `src/firebase.ts` - Google OAuth setup 