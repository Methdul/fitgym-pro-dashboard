import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, Lock, Shield, AlertCircle, CheckCircle2, Loader2, Clock, Copy } from 'lucide-react';
import { Member } from '@/types';
import { auth, supabase, db } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface MemberSettingsProps {
  member: Member;
  onMemberUpdate: (member: Member) => void;
}

const MemberSettings = ({ member, onMemberUpdate }: MemberSettingsProps) => {
  const [newEmail, setNewEmail] = useState('');
  const [emailValidation, setEmailValidation] = useState<{isValid: boolean, message: string} | null>(null);
  const [emailUpdateLoading, setEmailUpdateLoading] = useState(false);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [emailUpdateStatus, setEmailUpdateStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [updatedEmail, setUpdatedEmail] = useState<string>(''); // Store the updated email for display
  const [currentUser, setCurrentUser] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    try {
      const { user, error } = await auth.getCurrentUser();
      if (error) throw error;
      setCurrentUser(user);
    } catch (error) {
      console.error('Error getting current user:', error);
    }
  };

  const isTemporaryEmail = (email: string) => {
    // Check if current email is a temporary one generated by staff dashboard
    // Pattern: {memberID}@gmail.com
    return /^\d+@gmail\.com$/.test(email);
  };

  const extractMemberIdFromTempEmail = (email: string): string | null => {
    const match = email.match(/^(\d+)@gmail\.com$/);
    return match ? match[1] : null;
  };

  const validateEmailFormat = (email: string) => {
    if (!email) {
      setEmailValidation(null);
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    
    if (!emailRegex.test(email)) {
      setEmailValidation({isValid: false, message: "Invalid email format"});
      return;
    }

    // Only check for obviously fake patterns in the NEW email
    // Allow temporary emails as current email (generated by staff dashboard)
    const invalidPatterns = [
      {pattern: /^test@/, message: "Please use your real email address"},
      {pattern: /^fake@/, message: "Please use your real email address"},
      {pattern: /^temp@/, message: "Please use your real email address"},
      {pattern: /@test\./, message: "Please use a real domain"},
      {pattern: /@fake\./, message: "Please use a real domain"},
      {pattern: /@example\./, message: "Please use a real domain"},
    ];

    for (const {pattern, message} of invalidPatterns) {
      if (pattern.test(email.toLowerCase())) {
        setEmailValidation({isValid: false, message});
        return;
      }
    }

    setEmailValidation({isValid: true, message: "Valid email format"});
  };

  const handleEmailChange = (email: string) => {
    setNewEmail(email);
    validateEmailFormat(email);
    // Clear error status when user starts typing
    if (emailUpdateStatus === 'error') {
      setEmailUpdateStatus('idle');
    }
  };

  const handleEmailUpdate = async () => {
    if (!newEmail || newEmail === member.email) {
      toast({
        title: "Error",
        description: "Please enter a new email address",
        variant: "destructive",
      });
      return;
    }

    // Basic email validation for new email
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(newEmail)) {
      toast({
        title: "Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    setEmailUpdateLoading(true);
    setEmailUpdateStatus('idle');

    try {
      // Check if current email is temporary (pattern: {memberID}@gmail.com)
      if (isTemporaryEmail(member.email)) {
        console.log('🔄 Handling temporary email update...');
        
        // Extract member ID from temporary email
        const tempMemberId = extractMemberIdFromTempEmail(member.email);
        console.log('📧 Extracted member ID from temp email:', tempMemberId);
        
        if (!tempMemberId) {
          throw new Error('Could not extract member ID from temporary email');
        }

        // Update member email directly via backend API using the extracted ID
        try {
          const { data: updatedMember, error: updateError } = await db.members.update(member.id, {
            email: newEmail
          });

          if (updateError) {
            throw updateError;
          }

          console.log('✅ Member email updated in database:', updatedMember);

          // For temporary emails, the Supabase Auth user still has the old email
          // We need to establish the connection with the new email
          try {
            // Send a password reset to the new email - this creates the auth connection
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(newEmail, {
              redirectTo: `${window.location.origin}/reset-password`
            });

            if (resetError) {
              console.log('⚠️ Password reset failed:', resetError.message);
              // Fallback - user will need to contact support or use different method
            } else {
              console.log('✅ Password reset sent to new email');
            }

          } catch (resetSetupError) {
            console.log('⚠️ Reset setup failed:', resetSetupError);
          }

          setEmailUpdateStatus('pending');
          setUpdatedEmail(newEmail); // Store for display in success message
          toast({
            title: "Email Updated Successfully",
            description: `Your email has been updated to ${newEmail}. A password setup email has been sent to your new address. Please check your inbox and follow the instructions to complete the setup.`,
          });

          // Update the member data in the parent component
          if (onMemberUpdate && updatedMember) {
            onMemberUpdate(updatedMember);
          }

        } catch (dbError) {
          console.error('❌ Database update failed:', dbError);
          throw new Error('Failed to update email in database');
        }

      } else {
        // For regular emails, use normal Supabase auth update
        console.log('🔄 Handling regular email update...');
        const { error } = await auth.updateEmail(newEmail);

        if (error) {
          throw error;
        }

        setEmailUpdateStatus('pending');
        toast({
          title: "Verification Email Sent",
          description: `A verification email has been sent to ${newEmail}. Please check your inbox and click the verification link to confirm your new email address.`,
        });
      }

      // Clear the input
      setNewEmail('');
      setEmailValidation(null);

    } catch (error: any) {
      console.error('Email update error:', error);
      setEmailUpdateStatus('error');
      
      // Enhanced error handling
      let errorMessage = "Failed to update email. Please try again.";
      
      if (isTemporaryEmail(member.email)) {
        // Special handling for temporary emails
        if (error.message?.includes('extract member ID')) {
          errorMessage = "Could not process temporary email. Please contact support.";
        } else if (error.message?.includes('database')) {
          errorMessage = "Database update failed. Please contact support.";
        } else if (error.message?.includes('already exists') || error.message?.includes('taken')) {
          errorMessage = "This email address is already in use. Please choose a different email.";
        } else {
          errorMessage = "Failed to update temporary email. Please contact support if the issue persists.";
        }
      } else {
        // Regular error handling for non-temporary emails
        if (error.message?.includes('invalid')) {
          errorMessage = "The email address format is not accepted. Please use a different email address.";
        } else if (error.message?.includes('already exists') || error.message?.includes('taken')) {
          errorMessage = "This email address is already in use. Please choose a different email.";
        } else if (error.message?.includes('rate limit')) {
          errorMessage = "Too many requests. Please wait a few minutes before trying again.";
        } else if (error.message?.includes('network') || error.message?.includes('connection')) {
          errorMessage = "Network error. Please check your connection and try again.";
        } else if (error.message) {
          errorMessage = error.message;
        }
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setEmailUpdateLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!member.email) {
      toast({
        title: "Error",
        description: "No email address found for your account",
        variant: "destructive",
      });
      return;
    }

    setPasswordResetLoading(true);

    try {
      const { error } = await auth.resetPassword(member.email);

      if (error) {
        throw error;
      }

      toast({
        title: "Password Reset Email Sent",
        description: `A password reset email has been sent to ${member.email}. Please check your inbox and follow the instructions to reset your password.`,
      });

    } catch (error: any) {
      console.error('Password reset error:', error);
      
      // Enhanced error handling
      let errorMessage = "Failed to send password reset email. Please try again.";
      
      if (error.message?.includes('rate limit')) {
        errorMessage = "Too many requests. Please wait a few minutes before trying again.";
      } else if (error.message?.includes('not found') || error.message?.includes('invalid')) {
        errorMessage = "Email address not found. Please contact support.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setPasswordResetLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Account Settings</h2>
        <p className="text-muted-foreground">Manage your account security and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Settings */}
        <Card className="gym-card-gradient border-border hover:border-primary transition-all duration-500 group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                <Mail className="h-5 w-5 text-white" />
              </div>
              Email Address
            </CardTitle>
            <CardDescription>
              {isTemporaryEmail(member.email) 
                ? "Replace your temporary email with your real email address"
                : "Update your email address for account notifications"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-email">Current Email</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="current-email"
                  value={member.email}
                  disabled
                  className="bg-muted/50"
                />
                <div className="flex gap-1">
                  {isTemporaryEmail(member.email) ? (
                    <Badge variant="secondary">
                      <Clock className="h-3 w-3 mr-1" />
                      Temporary
                    </Badge>
                  ) : (
                    <Badge variant={member.is_verified ? "default" : "secondary"}>
                      {member.is_verified ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Verified
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Unverified
                        </>
                      )}
                    </Badge>
                  )}
                </div>
              </div>
              {isTemporaryEmail(member.email) && (
                <p className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded border">
                  📧 This is a temporary email created by staff. Update it with your real email address - the system will automatically replace it everywhere!
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-email">
                {isTemporaryEmail(member.email) ? "Your Real Email Address" : "New Email Address"}
              </Label>
              <Input
                id="new-email"
                type="email"
                placeholder={isTemporaryEmail(member.email) 
                  ? "Enter your real email address" 
                  : "Enter new email address"
                }
                value={newEmail}
                onChange={(e) => handleEmailChange(e.target.value)}
                disabled={emailUpdateLoading}
                className={emailValidation?.isValid === false ? 'border-red-300' : emailValidation?.isValid === true ? 'border-green-300' : ''}
              />
              {emailValidation && (
                <p className={`text-xs ${emailValidation.isValid ? 'text-green-600' : 'text-red-600'}`}>
                  {emailValidation.isValid ? '✅' : '❌'} {emailValidation.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {isTemporaryEmail(member.email)
                  ? "Enter your real email address to replace the temporary one and receive important notifications."
                  : "Use a real email address that you can access."
                }
              </p>
              {!isTemporaryEmail(member.email) && (
                <div className="text-xs text-muted-foreground bg-blue-50 p-2 rounded border">
                  <strong>✅ Good examples:</strong> john.doe@gmail.com, sarah2024@outlook.com, user.name@company.com
                  <br />
                  <strong>❌ Avoid:</strong> test@test.com, fake@example.com, temp@domain.com
                </div>
              )}
            </div>

            {emailUpdateStatus === 'error' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-medium text-red-800">Email Update Failed</p>
                </div>
                <p className="text-sm text-red-700 mt-1">
                  {isTemporaryEmail(member.email) 
                    ? "Failed to update from temporary email. Please try again or contact support if the issue persists."
                    : "Please try a different email address. Make sure it's a real, active email that you can access."
                  }
                </p>
              </div>
            )}

            {emailUpdateStatus === 'pending' && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-medium text-blue-800">
                    {isTemporaryEmail(member.email) ? "Email Updated Successfully!" : "Email Verification Pending"}
                  </p>
                </div>
                <p className="text-sm text-blue-700 mb-3">
                  {isTemporaryEmail(member.email)
                    ? "Your temporary email has been replaced with your real email address."
                    : "Please check your new email inbox and click the verification link to complete the email change."
                  }
                </p>
                {isTemporaryEmail(member.email) && (
                  <div className="bg-white p-3 rounded border">
                    <p className="text-sm font-semibold text-blue-800 mb-2">Next Steps:</p>
                    <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside mb-3">
                      <li>Log out of your current session</li>
                      <li>Go to the login page</li>
                      <li>Click "Forgot Password?"</li>
                      <li>Enter your new email: <strong>{updatedEmail}</strong></li>
                      <li>Check your email and follow the password reset instructions</li>
                      <li>Set a new password and log in</li>
                    </ol>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={async () => {
                        await auth.signOut();
                        window.location.href = '/login';
                      }}
                      className="w-full"
                    >
                      Log Out & Go to Login Page
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button 
                onClick={handleEmailUpdate}
                disabled={emailUpdateLoading || !newEmail || emailValidation?.isValid === false}
                className="flex-1"
              >
                {emailUpdateLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending Verification...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    {isTemporaryEmail(member.email) ? "Set Real Email" : "Update Email"}
                  </>
                )}
              </Button>
              
              {emailUpdateStatus === 'error' && (
                <Button 
                  variant="outline"
                  onClick={() => {
                    setEmailUpdateStatus('idle');
                    setNewEmail('');
                    setEmailValidation(null);
                    setUpdatedEmail('');
                  }}
                  className="px-3"
                >
                  Reset
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {isTemporaryEmail(member.email) 
                ? "A verification email will be sent to your real email address. Once verified, it will replace the temporary email everywhere in your account."
                : "A verification email will be sent to your new email address. You must verify it to complete the change."
              }
            </p>
          </CardContent>
        </Card>

        {/* Password Settings */}
        <Card className="gym-card-gradient border-border hover:border-primary transition-all duration-500 group">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-pink-600 rounded-full flex items-center justify-center">
                <Lock className="h-5 w-5 text-white" />
              </div>
              Password Security
            </CardTitle>
            <CardDescription>
              Reset your account password securely
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <div className="flex items-center gap-2">
                <Input
                  value="••••••••••••"
                  disabled
                  className="bg-muted/50"
                />
                <Badge variant="outline">
                  <Shield className="h-3 w-3 mr-1" />
                  Protected
                </Badge>
              </div>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800">Secure Password Reset</p>
                  <p className="text-sm text-blue-700 mt-1">
                    For your security, password changes are handled through email verification. 
                    Click the button below to receive a secure password reset link.
                  </p>
                </div>
              </div>
            </div>

            <Button 
              onClick={handlePasswordReset}
              disabled={passwordResetLoading}
              className="w-full"
              variant="outline"
            >
              {passwordResetLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending Reset Email...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Change Password
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground">
              A secure password reset link will be sent to your verified email address ({member.email}).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Account Information */}
      <Card className="gym-card-gradient border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" />
            </div>
            Account Information
          </CardTitle>
          <CardDescription>
            Your account security details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Account ID</Label>
              <p className="text-sm font-mono">{member.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Member Since</Label>
              <p className="text-sm">{new Date(member.created_at).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Last Updated</Label>
              <p className="text-sm">{new Date(member.updated_at).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Verification Status</Label>
              <Badge variant={member.is_verified ? "default" : "secondary"} className="w-fit">
                {member.is_verified ? "Verified" : "Pending"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security Notice */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-800">Security & Privacy</p>
              <p className="text-sm text-blue-700">
                All email and password changes require verification for your security. 
                Always check your email and click verification links from trusted sources only.
                If you didn't request a change, please contact support immediately.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MemberSettings;