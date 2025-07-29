import { auth, googleProvider } from '../firebase';

export const testFirebaseConfig = () => {
  console.log('=== Firebase Configuration Test ===');
  
  // Check if auth is initialized
  if (auth) {
    console.log('✅ Firebase Auth is initialized');
    console.log('Auth domain:', auth.config.authDomain);
  } else {
    console.error('❌ Firebase Auth is not initialized');
  }
  
  // Check if Google provider is configured
  if (googleProvider) {
    console.log('✅ Google Provider is configured');
  } else {
    console.error('❌ Google Provider is not configured');
  }
  
  // Check environment variables
  const requiredVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID'
  ];
  
  console.log('=== Environment Variables ===');
  requiredVars.forEach(varName => {
    const value = import.meta.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${value.substring(0, 10)}...`);
    } else {
      console.error(`❌ ${varName}: Not set`);
    }
  });
  
  return {
    authInitialized: !!auth,
    providerConfigured: !!googleProvider,
    envVarsSet: requiredVars.every(varName => !!import.meta.env[varName])
  };
}; 