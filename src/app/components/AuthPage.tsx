import { useState } from 'react';
import { Brain, LogIn, UserPlus, Mail, Lock, User, Sparkles, Archive } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { motion } from 'motion/react';
import { supabaseClient } from '/utils/supabase/client';
import { projectId, publicAnonKey } from '/utils/supabase/info';

interface AuthPageProps {
  onAuthSuccess: (accessToken: string, userName: string) => void;
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        // Sign Up via server endpoint which auto-confirms email
        console.log('Attempting sign up for:', email);
        const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-09672449/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email, password, name: name || email.split('@')[0] }),
        });

        let data;
        const responseText = await response.text();
        console.log('Raw server response:', responseText);
        
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Failed to parse server response:', parseError);
          throw new Error(`Server returned invalid response: ${responseText.substring(0, 100)}`);
        }

        console.log('Sign up response:', { status: response.status, data });

        if (!response.ok) {
          const errorMsg = data.error || data.message || responseText || 'Unknown error';
          
          // Special handling for existing user
          if (errorMsg.includes('already been registered') || errorMsg.includes('email_exists')) {
            setIsSignUp(false); // Switch to sign in mode
            throw new Error('An account with this email already exists. Please sign in instead.');
          }
          
          throw new Error(`Sign up failed: ${errorMsg}`);
        }

        if (!data.access_token) {
          throw new Error('Sign up succeeded but no access token was returned');
        }

        console.log('Sign up successful');
        onAuthSuccess(data.access_token, name || email.split('@')[0]);
      } else {
        // Sign In
        console.log('Attempting sign in for:', email);
        const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          console.error('Sign in error:', signInError);
          throw signInError;
        }
        if (!data.session?.access_token) {
          throw new Error('No access token received');
        }

        // Get user metadata
        const userName = data.user?.user_metadata?.name || email.split('@')[0];
        console.log('Sign in successful');
        onAuthSuccess(data.session.access_token, userName);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueAsGuest = () => {
    onAuthSuccess('', 'Guest');
  };

  return (
    <div className="h-screen w-full bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Open-Ended Problem Solving Support
          </h1>
          <p className="text-gray-600">
            Powered by OpenAI
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => {
                setIsSignUp(false);
                setError('');
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                !isSignUp
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setIsSignUp(true);
                setError('');
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition ${
                isSignUp
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="pl-10"
                    required={isSignUp}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-6 text-base"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {isSignUp ? (
                    <>
                      <UserPlus className="size-5" />
                      <span>Create Account</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="size-5" />
                      <span>Sign In</span>
                    </>
                  )}
                </div>
              )}
            </Button>
          </form>

          {/* Guest Mode */}
          <div className="mt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white text-gray-500">or</span>
              </div>
            </div>
            <Button
              type="button"
              onClick={handleContinueAsGuest}
              variant="outline"
              className="w-full mt-4 py-6 text-base border-gray-300 hover:bg-gray-50"
            >
              Continue as Guest
            </Button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Powered by OpenAI • Secure Authentication
        </p>
      </motion.div>
    </div>
  );
}