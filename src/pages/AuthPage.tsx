import { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel,
  IconButton, InputAdornment, InputLabel, Link, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
  Chip,
} from '@mui/material';
import {
  Lock, ContentCopy, Check,
  LocalShipping, BarChart, Shield, Forest, Public, Group, Room, AccessTime,
  Visibility, VisibilityOff, ArrowForward, Mail,
} from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import type { LoginAccountChoice, SignupInput } from '../context/AppContext';
import type { UserRole } from '../types';
import ForgotPasswordDialog from '../components/ForgotPasswordDialog';

const AuthPage = () => {
  const { login, signup, serverUrl, saveServerUrl } = useAppContext();
  const [isSignup, setIsSignup] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'signup',
  );
  const [role, setRole] = useState<UserRole>('admin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [serverAddress, setServerAddress] = useState(serverUrl);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [newGroupCode, setNewGroupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  // Hidden by default to keep the signup form compact — most admins never need it (the default
  // production server is right); drivers/admins joining over a LAN IP or Cloudflare Tunnel are
  // the case it exists for, so it stays reachable via this toggle instead of being removed.
  const [showServerAddress, setShowServerAddress] = useState(false);
  // Login no longer asks for a group code up front. Set only in the rare case where the same
  // phone + password are valid for more than one business — the user then taps one of these
  // instead of typing a code.
  const [accountChoices, setAccountChoices] = useState<LoginAccountChoice[] | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (serverAddress.trim() !== serverUrl) saveServerUrl(serverAddress.trim());
      if (isSignup) {
        const input: SignupInput = { name, phone, password, role, groupCode, groupName, email };
        const result = await signup(input);
        if (result.groupCode) setNewGroupCode(result.groupCode);
      } else {
        const result = await login({ phone, password });
        if (result.requiresGroupSelection && result.accounts) {
          setAccountChoices(result.accounts);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChooseAccount = async (choice: LoginAccountChoice) => {
    setError('');
    setLoading(true);
    try {
      await login({ phone, password, groupCode: choice.groupCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (newGroupCode) {
      navigator.clipboard.writeText(newGroupCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Show group code confirmation screen after admin signup
  if (newGroupCode) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          height: '100vh',
          width: '100vw',
          backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.6)), url(/login-bg.jpg)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          backgroundRepeat: 'no-repeat',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          overflow: 'hidden',
          fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 4 },
            maxWidth: 480,
            width: '100%',
            bgcolor: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1.5px solid rgba(255, 255, 255, 0.9)',
            borderRadius: '24px',
            boxShadow: '0 25px 60px rgba(15, 23, 42, 0.2)',
          }}
        >
          <Stack spacing={3}>
            <Box>
              <Chip label="Account Created!" sx={{ bgcolor: 'rgba(14,203,129,0.15)', color: '#059669', fontWeight: 800, mb: 2 }} />
              <Typography variant="h5" sx={{ color: '#0F172A', fontWeight: 900, fontFamily: 'inherit' }}>
                Share this Group Code with your Drivers
              </Typography>
              <Typography sx={{ color: '#475569', mt: 0.5, fontFamily: 'inherit' }}>
                Drivers must enter this code when signing up to join your transport group.
              </Typography>
            </Box>
            <Box sx={{ p: 3, bgcolor: 'rgba(255,255,255,0.95)', border: '2px solid #F5A623', borderRadius: '16px', textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1, letterSpacing: 2, fontWeight: 700 }}>
                YOUR GROUP CODE
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                <Typography variant="h3" sx={{ color: '#D97706', fontWeight: 900, letterSpacing: 6, fontFamily: 'monospace' }}>
                  {newGroupCode}
                </Typography>
                <Tooltip title={copied ? 'Copied!' : 'Copy code'}>
                  <IconButton onClick={handleCopy} sx={{ color: copied ? '#059669' : '#D97706' }}>
                    {copied ? <Check /> : <ContentCopy />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Alert severity="warning" sx={{ bgcolor: 'rgba(245,166,35,0.12)', color: '#92400E', border: '1px solid rgba(245,166,35,0.3)', borderRadius: '12px' }}>
              Save this code! Drivers need it to register. You can also find it in the sidebar after login.
            </Alert>
            <Button
              variant="contained"
              size="large"
              onClick={() => setNewGroupCode(null)}
              sx={{ bgcolor: '#F5A623', color: '#0F172A', fontWeight: 900, borderRadius: '14px', py: 1.5, '&:hover': { bgcolor: '#E59900' } }}
            >
              Continue to Dashboard
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: { xs: 'auto', lg: '100vh' },
        minHeight: '100vh',
        width: '100vw',
        position: 'relative',
        backgroundImage: `url(/login-bg.jpg)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: { xs: 'auto', lg: 'hidden' },
        fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
      }}
    >
      {/* Tightly Localized Soft White Glow Directly Behind Hero Text ONLY */}
      <Box
        sx={{
          position: 'absolute',
          top: '14%',
          left: '2%',
          width: { xs: '90%', md: '500px', lg: '580px' },
          height: { xs: '80%', md: '460px' },
          background: 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.55) 45%, rgba(255, 255, 255, 0) 75%)',
          pointerEvents: 'none',
          zIndex: 1,
          filter: 'blur(8px)',
        }}
      />

      {/* ── 1. TOP HEADER NAVBAR (Compact ~60px) ───────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 3, sm: 5, md: '70px' },
          pt: { xs: 2, lg: '18px' },
          pb: 0.5,
          width: '100%',
          zIndex: 10,
          boxSizing: 'border-box',
        }}
      >
        {/* Top Left Branding */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              bgcolor: '#0F172A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(15, 23, 42, 0.2)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 5 H22 V10 H16 V22 H10 V10 H4 V5 Z" fill="#F5A623" />
              <path d="M12 5 L22 5 L16 12 L10 12 Z" fill="#2563EB" opacity="0.9" />
            </svg>
          </Box>
          <Box>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 800,
                color: '#0F172A',
                lineHeight: 1.1,
                fontSize: '1.2rem',
                letterSpacing: '-0.3px',
                fontFamily: 'inherit',
              }}
            >
              Transport Management
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: '#334155',
                fontWeight: 700,
                letterSpacing: '2.2px',
                fontSize: '0.58rem',
                display: 'block',
                mt: 0.2,
                textTransform: 'uppercase',
                fontFamily: 'inherit',
              }}
            >
              MOVE  ·  MANAGE  ·  MONITOR  ·  GROW
            </Typography>
          </Box>
        </Box>

        {/* Top Right Navigation */}
        <Box sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'center', gap: 2.5 }}>
          {['PEOPLE', 'VEHICLES', 'GOODS', 'TECHNOLOGY', 'A BRIGHTER TOMORROW'].map((item, idx, arr) => (
            <Box key={item} sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  color: '#0F172A',
                  letterSpacing: '1.6px',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  '&:hover': { color: '#D97706' },
                  transition: 'color 0.2s',
                }}
              >
                {item}
              </Typography>
              {idx < arr.length - 1 && (
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 400, fontSize: '0.75rem' }}>
                  |
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── 2. MAIN CENTER HERO & LOGIN CARD SECTION (Shifted Downwards for Optimal Vertical Balance) ── */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          px: { xs: 3, sm: 5, md: '70px' },
          pt: { xs: 2, lg: '20px' },
          pb: { xs: 2, lg: '15px' },
          zIndex: 10,
          width: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: { xs: 3, lg: 2 },
          }}
        >
          {/* LEFT HERO SECTION */}
          <Box sx={{ flex: 1, maxWidth: { md: 500, lg: 560 } }}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                fontWeight: 700,
                color: '#334155',
                letterSpacing: '2.5px',
                fontSize: { xs: '0.7rem', sm: '0.75rem' },
                mb: 1,
                textTransform: 'uppercase',
                fontFamily: 'inherit',
              }}
            >
              SMART FLEET.  SEAMLESS OPERATIONS.
            </Typography>

            {/* Main Heading */}
            <Typography
              variant="h1"
              sx={{
                fontWeight: 800,
                color: '#0F172A',
                fontSize: { xs: '2.2rem', sm: '3.2rem', lg: '3.6rem' },
                lineHeight: 0.98,
                letterSpacing: '-1.5px',
                mb: 1.8,
                fontFamily: 'inherit',
              }}
            >
              Transporting
              <br />
              a Better
              <br />
              <Box component="span" sx={{ color: '#F5A623' }}>
                Tomorrow.
              </Box>
            </Typography>

            {/* Description Paragraph */}
            <Typography
              variant="body1"
              sx={{
                color: '#0F172A',
                fontSize: { xs: '0.88rem', sm: '0.96rem' },
                fontWeight: 500,
                lineHeight: 1.4,
                maxWidth: 470,
                mb: 2.5,
                fontFamily: 'inherit',
              }}
            >
              A complete transport management system to manage your fleet, trips, loads, drivers, and operations — across cities, across countries, for a brighter tomorrow.
            </Typography>

            {/* 5 Feature Icons Row */}
            <Paper
              elevation={0}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: { xs: 1.2, sm: 1.8 },
                px: 2.2,
                py: 1.2,
                borderRadius: '14px',
                bgcolor: 'rgba(255, 255, 255, 0.12)',
                backdropFilter: 'blur(5px)',
                WebkitBackdropFilter: 'blur(5px)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                boxShadow: 'none',
              }}
            >
              {[
                { icon: <LocalShipping sx={{ fontSize: 24, color: '#0F172A' }} />, l1: 'Real-time', l2: 'Tracking' },
                { icon: <BarChart sx={{ fontSize: 24, color: '#0F172A' }} />, l1: 'Smarter', l2: 'Operations' },
                { icon: <Shield sx={{ fontSize: 24, color: '#0F172A' }} />, l1: 'Safer', l2: 'Journeys' },
                { icon: <Forest sx={{ fontSize: 24, color: '#0F172A' }} />, l1: 'Lower', l2: 'Emissions' },
                { icon: <Public sx={{ fontSize: 24, color: '#0F172A' }} />, l1: 'Global', l2: 'Reach' },
              ].map((feat, index, arr) => (
                <Box key={feat.l1 + feat.l2} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.2, sm: 1.8 } }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 72 }}>
                    {feat.icon}
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        color: '#0F172A',
                        mt: 0.5,
                        fontSize: '0.72rem',
                        lineHeight: 1.2,
                        fontFamily: 'inherit',
                      }}
                    >
                      {feat.l1}
                      <br />
                      {feat.l2}
                    </Typography>
                  </Box>
                  {index < arr.length - 1 && (
                    <Box sx={{ width: '1px', height: 38, bgcolor: 'rgba(15, 23, 42, 0.25)' }} />
                  )}
                </Box>
              ))}
            </Paper>
          </Box>

          {/* RIGHT LOGIN FROSTED WHITE GLASS CARD (Compact Height ~460px to fit in viewport) */}
          <Box sx={{ width: '100%', maxWidth: 420 }}>
            <Paper
              elevation={0}
              sx={{
                // Signup shows several more fields than login — tighter padding here (plus the
                // smaller field heights and spacing below) keeps the whole card on-screen
                // without needing to scroll.
                p: isSignup ? { xs: 2, sm: 2.4 } : { xs: 2.5, sm: 3.2 },
                borderRadius: '22px',
                bgcolor: 'rgba(255, 255, 255, 0.72)',
                backdropFilter: 'blur(22px) saturate(180%)',
                WebkitBackdropFilter: 'blur(22px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.75)',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.12)',
              }}
            >
              {accountChoices ? (
                <Stack spacing={1.8}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#0F172A', fontSize: '1.65rem', letterSpacing: '-0.4px', fontFamily: 'inherit' }}>
                      Choose your business
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#475569', mt: 0.3, fontWeight: 500, fontSize: '0.82rem', fontFamily: 'inherit' }}>
                      This phone number and password are used on more than one account.
                    </Typography>
                  </Box>

                  {error && (
                    <Alert severity="error" sx={{ borderRadius: '10px', fontSize: '0.82rem', py: 0.5 }}>
                      {error}
                    </Alert>
                  )}

                  {accountChoices.map(choice => (
                    <Button
                      key={choice.groupCode}
                      onClick={() => handleChooseAccount(choice)}
                      disabled={loading}
                      fullWidth
                      variant="outlined"
                      sx={{
                        justifyContent: 'space-between',
                        bgcolor: 'rgba(255, 255, 255, 0.88)',
                        color: '#0F172A',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        height: 50,
                        borderRadius: '10px',
                        borderColor: 'rgba(148, 163, 184, 0.6)',
                        textTransform: 'none',
                        fontFamily: 'inherit',
                        '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.98)', borderColor: 'rgba(148, 163, 184, 0.9)' },
                      }}
                      endIcon={<ArrowForward sx={{ fontSize: 18 }} />}
                    >
                      {choice.groupName}
                    </Button>
                  ))}

                  <Box sx={{ textAlign: 'center', pt: 0.2 }}>
                    <Link
                      component="button"
                      type="button"
                      onClick={() => { setAccountChoices(null); setError(''); }}
                      underline="hover"
                      sx={{ color: '#2563EB', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'inherit' }}
                    >
                      Back to login
                    </Link>
                  </Box>
                </Stack>
              ) : (
              <form onSubmit={handleSubmit}>
                <Stack spacing={isSignup ? 1.3 : 1.8}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#0F172A', fontSize: isSignup ? '1.35rem' : '1.65rem', letterSpacing: '-0.4px', fontFamily: 'inherit' }}>
                      {isSignup ? 'Create Account' : 'Welcome Back'}
                    </Typography>
                    {!isSignup && (
                      <Typography variant="body2" sx={{ color: '#475569', mt: 0.3, fontWeight: 500, fontSize: '0.82rem', fontFamily: 'inherit' }}>
                        Log in to your Transport Management account
                      </Typography>
                    )}
                  </Box>

                  {error && (
                    <Alert severity="error" sx={{ borderRadius: '10px', fontSize: '0.82rem', py: 0.5 }}>
                      {error}
                    </Alert>
                  )}

                  {isSignup && (
                    <TextField
                      placeholder="Full Name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      fullWidth
                      InputProps={{
                        sx: {
                          borderRadius: '10px',
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          height: 40,
                          fontSize: '0.85rem',
                          color: '#0F172A',
                          border: '1.5px solid rgba(148, 163, 184, 0.6)',
                          '& fieldset': { border: 'none' },
                          '& input': {
                            color: '#0F172A',
                            fontWeight: 600,
                            '&::placeholder': { color: '#374151', opacity: 0.9, fontWeight: 500 },
                          },
                        },
                      }}
                    />
                  )}

                  {isSignup && (
                    <FormControl fullWidth size="small">
                      <InputLabel sx={{ color: '#374151', fontWeight: 600 }}>Account Type</InputLabel>
                      <Select
                        label="Account Type"
                        value={role}
                        onChange={e => setRole(e.target.value as UserRole)}
                        sx={{ borderRadius: '10px', bgcolor: 'rgba(255, 255, 255, 0.88)', height: 40, color: '#0F172A', fontWeight: 600 }}
                      >
                        <MenuItem value="admin">Admin / Owner</MenuItem>
                        <MenuItem value="driver">Driver / Employee</MenuItem>
                      </Select>
                    </FormControl>
                  )}

                  {isSignup && role === 'admin' && (
                    <TextField
                      placeholder="Transport Group Name"
                      value={groupName}
                      onChange={e => setGroupName(e.target.value)}
                      fullWidth
                      required
                      InputProps={{
                        sx: {
                          borderRadius: '10px',
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          height: 40,
                          fontSize: '0.85rem',
                          color: '#0F172A',
                          border: '1.5px solid rgba(148, 163, 184, 0.6)',
                          '& fieldset': { border: 'none' },
                          '& input': {
                            color: '#0F172A',
                            fontWeight: 600,
                            '&::placeholder': { color: '#374151', opacity: 0.9, fontWeight: 500 },
                          },
                        },
                      }}
                    />
                  )}

                  {isSignup && (
                    <TextField
                      placeholder={role === 'driver' ? 'Group Code (required from Admin)' : 'Group Code (optional)'}
                      value={groupCode}
                      onChange={e => setGroupCode(e.target.value.toUpperCase())}
                      fullWidth
                      required={role === 'driver'}
                      InputProps={{
                        sx: {
                          borderRadius: '10px',
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          height: 40,
                          fontSize: '0.85rem',
                          color: '#0F172A',
                          border: '1.5px solid rgba(148, 163, 184, 0.6)',
                          '& fieldset': { border: 'none' },
                          '& input': {
                            color: '#0F172A',
                            fontWeight: 600,
                            '&::placeholder': { color: '#374151', opacity: 0.9, fontWeight: 500 },
                          },
                        },
                      }}
                    />
                  )}

                  {/* Email / Phone Field */}
                  <TextField
                    placeholder="Email or phone number"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    fullWidth
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Mail sx={{ color: '#1E293B', fontSize: 18 }} />
                        </InputAdornment>
                      ),
                      sx: {
                        borderRadius: '10px',
                        bgcolor: 'rgba(255, 255, 255, 0.88)',
                        height: isSignup ? 40 : 46,
                        fontSize: isSignup ? '0.85rem' : '0.9rem',
                        color: '#0F172A',
                        border: '1.5px solid rgba(148, 163, 184, 0.65)',
                        '& fieldset': { border: 'none' },
                        '& input': {
                          color: '#0F172A',
                          fontWeight: 600,
                          '&::placeholder': {
                            color: '#374151',
                            opacity: 0.9,
                            fontWeight: 500,
                          },
                        },
                      },
                    }}
                  />

                  {/* Password Field */}
                  <TextField
                    placeholder="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    fullWidth
                    required
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Lock sx={{ color: '#1E293B', fontSize: 18 }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                            {showPassword ? <VisibilityOff sx={{ fontSize: 18, color: '#1E293B' }} /> : <Visibility sx={{ fontSize: 18, color: '#1E293B' }} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                      sx: {
                        borderRadius: '10px',
                        bgcolor: 'rgba(255, 255, 255, 0.88)',
                        height: isSignup ? 40 : 46,
                        fontSize: isSignup ? '0.85rem' : '0.9rem',
                        color: '#0F172A',
                        border: '1.5px solid rgba(148, 163, 184, 0.65)',
                        '& fieldset': { border: 'none' },
                        '& input': {
                          color: '#0F172A',
                          fontWeight: 600,
                          '&::placeholder': {
                            color: '#374151',
                            opacity: 0.9,
                            fontWeight: 500,
                          },
                        },
                      },
                    }}
                  />

                  {isSignup && role === 'admin' && (
                    <TextField
                      placeholder="Recovery Email (optional)"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      fullWidth
                      InputProps={{
                        sx: {
                          borderRadius: '10px',
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          height: 40,
                          fontSize: '0.85rem',
                          color: '#0F172A',
                          border: '1.5px solid rgba(148, 163, 184, 0.6)',
                          '& fieldset': { border: 'none' },
                          '& input': {
                            color: '#0F172A',
                            fontWeight: 600,
                            '&::placeholder': { color: '#374151', opacity: 0.9, fontWeight: 500 },
                          },
                        },
                      }}
                    />
                  )}

                  {isSignup && !showServerAddress && (
                    <Link
                      component="button"
                      type="button"
                      onClick={() => setShowServerAddress(true)}
                      underline="hover"
                      sx={{ color: '#64748B', fontWeight: 600, fontSize: '0.76rem', fontFamily: 'inherit', textAlign: 'left' }}
                    >
                      Joining over a LAN/tunnel link? Set a custom server address
                    </Link>
                  )}

                  {isSignup && showServerAddress && (
                    <TextField
                      placeholder="Server Address e.g. https://api.yourdomain.com"
                      value={serverAddress}
                      onChange={e => setServerAddress(e.target.value)}
                      fullWidth
                      size="small"
                      autoFocus
                      InputProps={{
                        sx: {
                          borderRadius: '10px',
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          height: 36,
                          fontSize: '0.8rem',
                          color: '#0F172A',
                          border: '1.5px solid rgba(148, 163, 184, 0.6)',
                          '& fieldset': { border: 'none' },
                          '& input': {
                            color: '#0F172A',
                            fontWeight: 600,
                            '&::placeholder': { color: '#374151', opacity: 0.9, fontWeight: 500 },
                          },
                        },
                      }}
                    />
                  )}

                  {/* Remember Me + Forgot Password Row */}
                  {!isSignup && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={rememberMe}
                            onChange={e => setRememberMe(e.target.checked)}
                            size="small"
                            sx={{ color: '#64748B', '&.Mui-checked': { color: '#0F172A' }, p: 0.5 }}
                          />
                        }
                        label={<Typography variant="body2" sx={{ color: '#334155', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'inherit' }}>Remember me</Typography>}
                      />
                      <Link
                        component="button"
                        type="button"
                        onClick={() => setForgotPasswordOpen(true)}
                        underline="hover"
                        sx={{ color: '#2563EB', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'inherit' }}
                      >
                        Forgot password?
                      </Link>
                    </Box>
                  )}

                  {/* Primary Golden-Yellow Log In Button */}
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={loading}
                    sx={{
                      bgcolor: '#F5A623',
                      color: '#0F172A',
                      fontWeight: 800,
                      fontSize: isSignup ? '0.9rem' : '0.98rem',
                      height: isSignup ? 40 : 46,
                      borderRadius: '10px',
                      textTransform: 'none',
                      boxShadow: 'none',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1.2,
                      '&:hover': {
                        bgcolor: '#E59900',
                        boxShadow: '0 6px 16px rgba(245, 166, 35, 0.3)',
                      },
                    }}
                  >
                    <span>{loading ? 'Please wait...' : isSignup ? 'Create Account' : 'Log In'}</span>
                    <ArrowForward sx={{ fontSize: 18 }} />
                  </Button>

                  {/* OR / Continue with Google — decorative only (onClick just resubmits this
                      form; there's no real Google OAuth flow), so it's skipped in signup mode
                      to keep that form short enough to fit on-screen without scrolling. */}
                  {!isSignup && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(203, 213, 225, 0.7)' }} />
                        <Typography variant="caption" sx={{ px: 1.5, color: '#64748B', fontWeight: 600, fontSize: '0.7rem', fontFamily: 'inherit' }}>
                          OR
                        </Typography>
                        <Box sx={{ flex: 1, height: '1px', bgcolor: 'rgba(203, 213, 225, 0.7)' }} />
                      </Box>

                      <Button
                        variant="outlined"
                        fullWidth
                        onClick={handleSubmit}
                        sx={{
                          bgcolor: 'rgba(255, 255, 255, 0.88)',
                          color: '#0F172A',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          height: 46,
                          borderRadius: '10px',
                          textTransform: 'none',
                          borderColor: 'rgba(203, 213, 225, 0.8)',
                          fontFamily: 'inherit',
                          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.04)',
                          '&:hover': {
                            bgcolor: 'rgba(255, 255, 255, 0.98)',
                            borderColor: 'rgba(203, 213, 225, 1)',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                          <svg width="17" height="17" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.617z" fill="#4285F4"/>
                            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                          </svg>
                          <span>Continue with Google</span>
                        </Box>
                      </Button>
                    </>
                  )}

                  {/* Create Account Link Footer */}
                  <Box sx={{ textAlign: 'center', pt: 0.2 }}>
                    <Typography variant="body2" sx={{ color: '#475569', fontWeight: 500, fontSize: '0.82rem', fontFamily: 'inherit' }}>
                      {isSignup ? 'Already have an account? ' : 'New to Transport Management? '}
                      <Link
                        component="button"
                        type="button"
                        onClick={() => {
                          setIsSignup(!isSignup);
                          setError('');
                        }}
                        underline="hover"
                        sx={{ color: '#2563EB', fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        {isSignup ? 'Log in' : 'Create an account'}
                      </Link>
                    </Typography>
                  </Box>
                </Stack>
              </form>
              )}
            </Paper>
          </Box>
        </Box>
      </Box>

      {/* ── 3. BOTTOM STATISTIC STRIP & HIGH-DETAIL RECOGNIZABLE DOTTED WORLD MAP FOOTER (Compact ~85px) ── */}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          minHeight: { lg: '80px' },
          maxHeight: { lg: '90px' },
          bgcolor: 'rgba(15, 23, 42, 0.42)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.15)',
          px: { xs: 3, sm: 5, md: '60px' },
          py: { xs: 1, lg: 0.8 },
          zIndex: 10,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'flex-start', md: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          boxSizing: 'border-box',
        }}
      >
        {/* Bottom Left Statistics */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.8, sm: 3, lg: 3.8 }, flexWrap: 'wrap' }}>
            {[
              { icon: <LocalShipping sx={{ color: '#FFF', fontSize: 18 }} />, val: '10K+', lbl: 'Active Vehicles' },
              { icon: <Group sx={{ color: '#FFF', fontSize: 18 }} />, val: '5K+', lbl: 'Drivers & Partners' },
              { icon: <Room sx={{ color: '#FFF', fontSize: 18 }} />, val: '100+', lbl: 'Cities Covered' },
              { icon: <AccessTime sx={{ color: '#FFF', fontSize: 18 }} />, val: '99.8%', lbl: 'On-Time Deliveries' },
            ].map((stat, idx, arr) => (
              <Box key={stat.lbl} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.8, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  {stat.icon}
                  <Box>
                    <Typography variant="body1" sx={{ fontWeight: 800, color: '#FFF', lineHeight: 1.0, fontSize: '0.9rem', fontFamily: 'inherit' }}>
                      {stat.val}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500, fontSize: '0.62rem', fontFamily: 'inherit' }}>
                      {stat.lbl}
                    </Typography>
                  </Box>
                </Box>
                {idx < arr.length - 1 && (
                  <Box sx={{ width: '1px', height: 20, bgcolor: 'rgba(255, 255, 255, 0.25)' }} />
                )}
              </Box>
            ))}
          </Box>

          {/* Bottom Left Tagline */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.1 }}>
            <Box sx={{ width: 26, height: 2, bgcolor: '#F5A623', borderRadius: 1 }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '1.8px', fontSize: '0.58rem', textTransform: 'uppercase', fontFamily: 'inherit' }}>
              ROAD TO A STRONGER TOMORROW
            </Typography>
          </Box>
        </Box>

        {/* Bottom Right Highly Recognizable Dotted World Map Graphic & Tagline */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          {/* Subtle Localized Glow behind Map */}
          <Box
            sx={{
              position: 'absolute',
              width: 240,
              height: 75,
              left: -10,
              top: -5,
              background: 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 55%, transparent 75%)',
              pointerEvents: 'none',
            }}
          />

          {/* Recognizable Dotted World Map Silhouette SVG (220px x 62px) */}
          <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'relative', zIndex: 1 }}>
            <svg width="220" height="62" viewBox="0 0 350 130" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Continental Dot Matrix */}
              <g fill="rgba(255, 255, 255, 0.85)">
                {/* NORTH AMERICA */}
                <circle cx="20" cy="18" r="1.5"/><circle cx="28" cy="16" r="1.5"/><circle cx="36" cy="14" r="1.5"/><circle cx="44" cy="14" r="1.5"/><circle cx="52" cy="16" r="1.5"/><circle cx="60" cy="18" r="1.5"/>
                <circle cx="68" cy="15" r="1.5"/><circle cx="76" cy="18" r="1.5"/><circle cx="84" cy="20" r="1.5"/>
                <circle cx="30" cy="24" r="1.5"/><circle cx="38" cy="22" r="1.5"/><circle cx="46" cy="22" r="1.5"/><circle cx="54" cy="24" r="1.5"/><circle cx="62" cy="25" r="1.5"/><circle cx="70" cy="24" r="1.5"/><circle cx="78" cy="26" r="1.5"/><circle cx="86" cy="28" r="1.5"/>
                <circle cx="34" cy="30" r="1.5"/><circle cx="42" cy="29" r="1.5"/><circle cx="50" cy="28" r="1.5"/><circle cx="58" cy="30" r="1.5"/><circle cx="66" cy="31" r="1.5"/><circle cx="74" cy="32" r="1.5"/><circle cx="82" cy="34" r="1.5"/><circle cx="90" cy="36" r="1.5"/>
                <circle cx="40" cy="36" r="1.5"/><circle cx="48" cy="35" r="1.5"/><circle cx="56" cy="36" r="1.5"/><circle cx="64" cy="37" r="1.5"/><circle cx="72" cy="38" r="1.5"/><circle cx="80" cy="40" r="1.8"/>
                <circle cx="48" cy="42" r="1.5"/><circle cx="54" cy="43" r="1.5"/><circle cx="60" cy="44" r="1.5"/><circle cx="66" cy="46" r="1.5"/><circle cx="72" cy="48" r="1.5"/>
                <circle cx="58" cy="50" r="1.5"/><circle cx="64" cy="52" r="1.5"/><circle cx="70" cy="54" r="1.5"/><circle cx="76" cy="57" r="1.5"/>

                {/* SOUTH AMERICA */}
                <circle cx="82" cy="62" r="1.5"/><circle cx="88" cy="61" r="1.5"/><circle cx="94" cy="62" r="1.5"/><circle cx="100" cy="64" r="1.5"/><circle cx="106" cy="66" r="1.5"/>
                <circle cx="84" cy="68" r="1.5"/><circle cx="90" cy="67" r="1.5"/><circle cx="96" cy="68" r="1.5"/><circle cx="102" cy="70" r="1.5"/><circle cx="108" cy="72" r="1.5"/><circle cx="112" cy="74" r="1.5"/>
                <circle cx="86" cy="74" r="1.5"/><circle cx="92" cy="74" r="1.5"/><circle cx="98" cy="76" r="1.5"/><circle cx="104" cy="78" r="1.5"/><circle cx="110" cy="80" r="1.5"/>
                <circle cx="88" cy="80" r="1.5"/><circle cx="94" cy="81" r="1.5"/><circle cx="100" cy="83" r="1.5"/><circle cx="106" cy="86" r="1.5"/>
                <circle cx="90" cy="87" r="1.5"/><circle cx="96" cy="88" r="1.5"/><circle cx="102" cy="91" r="1.5"/>
                <circle cx="92" cy="94" r="1.5"/><circle cx="98" cy="96" r="1.5"/>
                <circle cx="94" cy="102" r="1.5"/><circle cx="96" cy="108" r="1.5"/>

                {/* EUROPE & UK */}
                <circle cx="146" cy="16" r="1.5"/><circle cx="152" cy="14" r="1.5"/><circle cx="158" cy="13" r="1.5"/><circle cx="164" cy="15" r="1.5"/>
                <circle cx="140" cy="22" r="1.5"/><circle cx="148" cy="20" r="1.5"/><circle cx="156" cy="19" r="1.8"/><circle cx="164" cy="20" r="1.5"/><circle cx="172" cy="22" r="1.5"/><circle cx="180" cy="23" r="1.5"/>
                <circle cx="144" cy="27" r="1.5"/><circle cx="152" cy="26" r="1.5"/><circle cx="160" cy="25" r="1.5"/><circle cx="168" cy="26" r="1.5"/><circle cx="176" cy="28" r="1.5"/><circle cx="184" cy="29" r="1.5"/>
                <circle cx="142" cy="33" r="1.5"/><circle cx="150" cy="32" r="1.5"/><circle cx="158" cy="31" r="1.5"/><circle cx="166" cy="32" r="1.5"/><circle cx="174" cy="34" r="1.5"/><circle cx="182" cy="35" r="1.5"/>
                <circle cx="148" cy="39" r="1.5"/><circle cx="156" cy="38" r="1.5"/><circle cx="164" cy="38" r="1.5"/><circle cx="172" cy="40" r="1.5"/><circle cx="180" cy="41" r="1.5"/>

                {/* AFRICA */}
                <circle cx="146" cy="46" r="1.5"/><circle cx="154" cy="45" r="1.5"/><circle cx="162" cy="45" r="1.5"/><circle cx="170" cy="46" r="1.5"/><circle cx="178" cy="47" r="1.5"/><circle cx="186" cy="48" r="1.5"/><circle cx="194" cy="50" r="1.5"/>
                <circle cx="144" cy="52" r="1.5"/><circle cx="152" cy="51" r="1.5"/><circle cx="160" cy="51" r="1.5"/><circle cx="168" cy="52" r="1.5"/><circle cx="176" cy="53" r="1.5"/><circle cx="184" cy="55" r="1.5"/><circle cx="192" cy="57" r="1.5"/><circle cx="200" cy="58" r="1.5"/>
                <circle cx="156" cy="58" r="1.5"/><circle cx="164" cy="57" r="1.5"/><circle cx="172" cy="58" r="1.5"/><circle cx="180" cy="60" r="1.5"/><circle cx="188" cy="62" r="1.5"/><circle cx="196" cy="64" r="1.5"/>
                <circle cx="166" cy="64" r="1.5"/><circle cx="174" cy="64" r="1.5"/><circle cx="182" cy="66" r="1.5"/><circle cx="190" cy="68" r="1.5"/><circle cx="198" cy="70" r="1.5"/>
                <circle cx="170" cy="70" r="1.5"/><circle cx="178" cy="71" r="1.5"/><circle cx="186" cy="73" r="1.5"/><circle cx="194" cy="76" r="1.5"/>
                <circle cx="174" cy="77" r="1.5"/><circle cx="182" cy="78" r="1.5"/><circle cx="190" cy="81" r="1.5"/>
                <circle cx="178" cy="84" r="1.5"/><circle cx="184" cy="85" r="1.5"/><circle cx="188" cy="88" r="1.5"/>
                <circle cx="182" cy="91" r="1.5"/><circle cx="186" cy="95" r="1.5"/>
                <circle cx="208" cy="72" r="1.5"/><circle cx="206" cy="78" r="1.5"/><circle cx="204" cy="84" r="1.5"/>

                {/* ASIA & MIDDLE EAST & INDIA */}
                <circle cx="192" cy="15" r="1.5"/><circle cx="200" cy="14" r="1.5"/><circle cx="208" cy="13" r="1.5"/><circle cx="216" cy="12" r="1.5"/><circle cx="224" cy="13" r="1.5"/><circle cx="232" cy="14" r="1.5"/><circle cx="240" cy="13" r="1.5"/><circle cx="248" cy="14" r="1.5"/><circle cx="256" cy="15" r="1.5"/><circle cx="264" cy="16" r="1.5"/><circle cx="272" cy="18" r="1.5"/>
                <circle cx="190" cy="21" r="1.5"/><circle cx="198" cy="20" r="1.5"/><circle cx="206" cy="19" r="1.5"/><circle cx="214" cy="18" r="1.5"/><circle cx="222" cy="19" r="1.5"/><circle cx="230" cy="20" r="1.5"/><circle cx="238" cy="19" r="1.5"/><circle cx="246" cy="20" r="1.5"/><circle cx="254" cy="21" r="1.5"/><circle cx="262" cy="22" r="1.8"/><circle cx="270" cy="24" r="1.5"/><circle cx="278" cy="25" r="1.5"/>
                <circle cx="196" cy="27" r="1.5"/><circle cx="204" cy="26" r="1.5"/><circle cx="212" cy="25" r="1.5"/><circle cx="220" cy="25" r="1.5"/><circle cx="228" cy="26" r="1.5"/><circle cx="236" cy="25" r="1.5"/><circle cx="244" cy="26" r="1.5"/><circle cx="252" cy="27" r="1.5"/><circle cx="260" cy="28" r="1.5"/><circle cx="268" cy="30" r="1.5"/><circle cx="276" cy="31" r="1.5"/><circle cx="284" cy="32" r="1.5"/>
                <circle cx="198" cy="33" r="1.5"/><circle cx="206" cy="32" r="1.5"/><circle cx="214" cy="31" r="1.5"/><circle cx="222" cy="31" r="1.5"/><circle cx="230" cy="32" r="1.5"/><circle cx="238" cy="31" r="1.5"/><circle cx="246" cy="32" r="1.5"/><circle cx="254" cy="33" r="1.5"/><circle cx="262" cy="35" r="1.5"/><circle cx="270" cy="37" r="1.5"/><circle cx="278" cy="38" r="1.5"/>
                <circle cx="202" cy="39" r="1.5"/><circle cx="210" cy="38" r="1.8"/><circle cx="218" cy="37" r="1.5"/><circle cx="226" cy="37" r="1.5"/><circle cx="234" cy="38" r="1.5"/><circle cx="242" cy="37" r="1.5"/><circle cx="250" cy="38" r="1.5"/><circle cx="258" cy="40" r="1.5"/><circle cx="266" cy="43" r="1.5"/><circle cx="274" cy="44" r="1.5"/><circle cx="282" cy="45" r="1.5"/>
                <circle cx="218" cy="44" r="1.5"/><circle cx="224" cy="43" r="1.5"/><circle cx="230" cy="44" r="1.5"/><circle cx="236" cy="44" r="1.5"/><circle cx="244" cy="44" r="1.5"/><circle cx="252" cy="45" r="1.5"/><circle cx="260" cy="47" r="1.5"/><circle cx="268" cy="50" r="1.5"/><circle cx="276" cy="51" r="1.5"/>
                <circle cx="224" cy="50" r="1.8"/><circle cx="230" cy="50" r="1.5"/><circle cx="236" cy="51" r="1.5"/><circle cx="242" cy="51" r="1.5"/><circle cx="254" cy="52" r="1.5"/><circle cx="262" cy="54" r="1.5"/><circle cx="270" cy="57" r="1.5"/>
                <circle cx="228" cy="56" r="1.5"/><circle cx="234" cy="57" r="1.5"/><circle cx="240" cy="58" r="1.5"/><circle cx="256" cy="59" r="1.5"/><circle cx="264" cy="62" r="1.5"/><circle cx="272" cy="64" r="1.5"/>
                <circle cx="232" cy="62" r="1.5"/><circle cx="258" cy="66" r="1.5"/><circle cx="266" cy="69" r="1.5"/><circle cx="274" cy="71" r="1.5"/>

                {/* JAPAN */}
                <circle cx="288" cy="28" r="1.5"/><circle cx="292" cy="34" r="1.5"/><circle cx="296" cy="40" r="1.5"/>

                {/* AUSTRALIA & NEW ZEALAND */}
                <circle cx="268" cy="78" r="1.5"/><circle cx="276" cy="77" r="1.5"/><circle cx="284" cy="76" r="1.5"/><circle cx="292" cy="77" r="1.5"/><circle cx="300" cy="79" r="1.5"/><circle cx="308" cy="81" r="1.5"/>
                <circle cx="266" cy="84" r="1.5"/><circle cx="274" cy="83" r="1.5"/><circle cx="282" cy="82" r="1.5"/><circle cx="290" cy="83" r="1.5"/><circle cx="298" cy="85" r="1.5"/><circle cx="306" cy="87" r="1.5"/><circle cx="314" cy="89" r="1.8"/>
                <circle cx="270" cy="90" r="1.5"/><circle cx="278" cy="89" r="1.5"/><circle cx="286" cy="88" r="1.5"/><circle cx="294" cy="89" r="1.5"/><circle cx="302" cy="91" r="1.5"/><circle cx="310" cy="93" r="1.5"/>
                <circle cx="276" cy="96" r="1.5"/><circle cx="284" cy="95" r="1.5"/><circle cx="292" cy="95" r="1.5"/><circle cx="300" cy="97" r="1.5"/>
                <circle cx="282" cy="102" r="1.5"/><circle cx="290" cy="101" r="1.5"/>
                <circle cx="324" cy="98" r="1.5"/><circle cx="328" cy="104" r="1.5"/>
              </g>

              {/* Golden Yellow Connection Arcs & Glowing Hub Nodes */}
              <path d="M 80 40 Q 118 6, 156 19" stroke="#F5A623" strokeWidth="2.2" strokeDasharray="4 3" fill="none" />
              <path d="M 156 19 Q 192 10, 224 50" stroke="#F5A623" strokeWidth="2.2" strokeDasharray="4 3" fill="none" />
              <path d="M 224 50 Q 256 22, 292 34" stroke="#F5A623" strokeWidth="2" strokeDasharray="4 3" fill="none" />
              <path d="M 224 50 Q 260 62, 314 89" stroke="#F5A623" strokeWidth="2.2" strokeDasharray="4 3" fill="none" />
              <path d="M 80 40 Q 94 62, 108 72" stroke="rgba(245, 166, 35, 0.85)" strokeWidth="1.8" strokeDasharray="3 2" fill="none" />
              <path d="M 156 19 Q 170 38, 184 55" stroke="rgba(245, 166, 35, 0.85)" strokeWidth="1.8" strokeDasharray="3 2" fill="none" />

              {/* Hub Glowing Pulse Circles */}
              <circle cx="80" cy="40" r="3.5" fill="#F5A623" />
              <circle cx="80" cy="40" r="6.5" fill="#F5A623" opacity="0.35" />

              <circle cx="156" cy="19" r="4" fill="#F5A623" />
              <circle cx="156" cy="19" r="7.5" fill="#F5A623" opacity="0.4" />

              <circle cx="224" cy="50" r="4.5" fill="#F5A623" />
              <circle cx="224" cy="50" r="8" fill="#F5A623" opacity="0.45" />

              <circle cx="292" cy="34" r="3.5" fill="#F5A623" />
              <circle cx="292" cy="34" r="6.5" fill="#F5A623" opacity="0.35" />

              <circle cx="314" cy="89" r="4" fill="#F5A623" />
              <circle cx="314" cy="89" r="7" fill="#F5A623" opacity="0.4" />
            </svg>
          </Box>

          {/* Connecting Businesses Tagline */}
          <Box sx={{ position: 'relative', zIndex: 1, minWidth: 125 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: '#FFFFFF',
                letterSpacing: '1.8px',
                fontSize: '0.65rem',
                textTransform: 'uppercase',
                display: 'block',
                lineHeight: 1.15,
                fontFamily: 'inherit',
              }}
            >
              CONNECTING
              <br />
              BUSINESSES
              <br />
              WORLDWIDE
            </Typography>
            <Box sx={{ width: 24, height: 2, bgcolor: '#F5A623', mt: 0.4, borderRadius: 1 }} />
          </Box>
        </Box>
      </Box>

      {/* Forgot Password Dialog */}
      <ForgotPasswordDialog
        open={forgotPasswordOpen}
        onClose={() => setForgotPasswordOpen(false)}
        initialGroupCode={groupCode}
      />
    </Box>
  );
};

export default AuthPage;
