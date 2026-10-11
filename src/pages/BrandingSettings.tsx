import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Alert, Box, Button, Divider, GridLegacy as Grid, Paper, Stack, TextField, Typography, IconButton,
  FormControl, InputLabel, Select, MenuItem, useTheme,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Save, Add, Delete, AccountBalance,
  PhotoCamera, AutoFixHigh, Security, Image as ImageIcon, QrCode2, Receipt,
} from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import type { Branding, BankAccount } from '../types';
import { processSignaturePhoto, processSignatureScan } from '../utils/signatureImage';
import { fileToImage } from '../utils/imageEncoding';
import { HEADER_IMAGE_ASPECT, autoFitHeaderImage, needsManualCrop, renderHeaderImageCrop } from '../utils/headerImage';
import { processUpiQrImage } from '../utils/upiQrImage';
import ImageCropDialog from '../components/ImageCropDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import { useToast } from '../components/ToastProvider';

const EMPTY: Branding = {
  companyName: '', tagline: '', proprietorName: '', phone1: '', phone2: '', address: '',
  gstNumber: '', footerNote: '', primaryColor: '#0B2B5E', accentColor: '#F0B90B',
  logoDataUrl: '', signatureDataUrl: '', headerLeftImageDataUrl: '', headerRightImageDataUrl: '',
  upiQrImageDataUrl: '', upiQrShowOn: 'both',
  bankName: '', bankBranch: '', bankAccountNumber: '', bankIfsc: '',
  bankAccounts: [], publicServerUrl: '', nextInvoiceNumber: 1,
};

type HeaderImageField = 'headerLeftImageDataUrl' | 'headerRightImageDataUrl';

const HEADER_IMAGE_PREVIEW_WIDTH = 160;
const HEADER_IMAGE_PREVIEW_HEIGHT = Math.round(HEADER_IMAGE_PREVIEW_WIDTH / HEADER_IMAGE_ASPECT);

function buildDemoBillHtml(form: Branding): string {
  const esc = (v: string | number) =>
    String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const primaryColor = form.primaryColor || '#0B2B5E';
  const accentColor = form.accentColor || '#F0B90B';
  const companyName = (form.companyName || 'Your Company Name').toUpperCase();
  const tagline = form.tagline || 'Transport & Logistics Solutions';
  const proprietorLine = form.proprietorName ? `Prop.: ${form.proprietorName}` : '';
  const phones = [form.phone1, form.phone2].filter(Boolean).join(' &nbsp;/&nbsp; ');
  const contactLine = [proprietorLine, phones ? `Mob.: ${phones}` : ''].filter(Boolean).join(' &nbsp;&nbsp;|&nbsp;&nbsp; ');
  const addressLine = form.address || '';
  const logoUrl = form.logoDataUrl || '';
  const signatureUrl = form.signatureDataUrl || '';
  const headerLeftUrl = form.headerLeftImageDataUrl || '';
  const headerRightUrl = form.headerRightImageDataUrl || '';
  const upiQrUrl = form.upiQrImageDataUrl || '';
  const bank = form.bankAccounts?.[0];

  const demoTrips = [
    { date: '15/10/2026', pickup: 'Mumbai', drop: 'Pune', paid: '500.00', amount: '8,500.00' },
    { date: '16/10/2026', pickup: 'Pune', drop: 'Nashik', paid: '0.00', amount: '6,200.00' },
    { date: '18/10/2026', pickup: 'Nashik', drop: 'Mumbai', paid: '1,000.00', amount: '9,000.00' },
  ];

  const rowsHtml = demoTrips.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#fdf6f0'};">
      <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:center;">${t.date}</td>
      <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;">${t.pickup}</td>
      <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;">${t.drop}</td>
      <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:right;">₹${t.paid}</td>
      <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:right;">₹${t.amount}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
    * { box-sizing:border-box; } body { margin:0; padding:12px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:10pt; color:#1a1a1a; background:#fff; }
    .page { width:100%; max-width:190mm; margin:0 auto; position:relative; background:#fff; }
    ${logoUrl ? `.page::before { content:''; position:absolute; bottom:20mm; left:10mm; width:85mm; height:52mm; background:url('${logoUrl}') center/contain no-repeat; opacity:0.05; pointer-events:none; z-index:0; }` : ''}
    .page > * { position:relative; z-index:1; }
    .accent-bar { height:4px; background:${accentColor}; margin-bottom:16px; }
    .header { display:flex; align-items:center; justify-content:center; gap:10px; padding-bottom:14px; margin-bottom:16px; border-bottom:3px double #CBD5E1; }
    .header-image-slot { flex:0 0 30mm; width:30mm; height:22.5mm; display:flex; align-items:center; justify-content:center; }
    .header-image-slot img { max-width:100%; max-height:100%; object-fit:contain; }
    .header-text { flex:1; text-align:center; min-width:0; }
    .company-name { font-size:24pt; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:${primaryColor}; }
    .tagline { font-size:9.5pt; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#8a8a8a; margin-top:4px; }
    .contact-line { font-size:9pt; color:#555; margin-top:6px; font-weight:500; }
    .address-line { font-size:8.5pt; color:#777; margin-top:2px; }
    .info-grid { display:flex; gap:24px; margin-bottom:20px; }
    .info-col { flex:1; }
    .info-col table { width:100%; border-collapse:collapse; }
    .info-col td { font-size:9.5pt; padding:2px 0; vertical-align:top; color:#333; }
    .info-col td.label { color:#666; font-weight:600; width:78px; white-space:nowrap; padding-right:8px; }
    .info-col td.strong { font-weight:700; color:${primaryColor}; }
    .tt { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:9pt; }
    .tt th { background:${primaryColor}; color:#fff; padding:7px 8px; border:1px solid #E2E8F0; font-weight:700; text-align:center; }
    .tt th.l { text-align:left; } .tt th.r, .tt td.r { text-align:right; }
    .tt td { padding:6px 8px; border:1px solid #E2E8F0; color:#1a1a1a; }
    .subtotal-row td { font-weight:700; color:${primaryColor}; }
    .words-row { display:flex; gap:14px; align-items:flex-start; margin-bottom:16px; }
    .words-col { flex:1; min-width:0; }
    .words-box { padding:8px 10px; background:#fcfcfc; border:1px dashed #ddd; border-radius:4px; font-size:9pt; color:#555; }
    .words-box b { color:#1a1a1a; }
    .upi-qr-box { flex:0 0 90px; width:90px; height:90px; display:flex; align-items:center; justify-content:center; }
    .upi-qr-box img { max-width:100%; max-height:100%; object-fit:contain; }
    .footer-row { display:flex; gap:24px; border-top:2px double #CBD5E1; padding-top:14px; font-size:9pt; color:#444; }
    .bank-col { flex:1; }
    .bank-title { font-weight:700; color:${primaryColor}; margin-bottom:4px; font-size:9.5pt; }
    .bank-col table { width:100%; font-size:8.5pt; }
    .bank-col td.label { color:#666; font-weight:600; width:95px; }
    .bank-col td.strong { font-weight:700; color:#111; }
    .sign-col { flex:0 0 160px; text-align:right; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; }
    .for-company { font-weight:600; color:#333; font-style:italic; margin-bottom:8px; }
    .sign-img { max-width:140px; max-height:50px; object-fit:contain; margin-bottom:4px; }
    .sign-line { font-weight:700; border-top:1px solid #666; padding-top:4px; width:140px; margin-left:auto; text-align:center; font-size:8.5pt; }
    .footer-note { text-align:center; margin-top:18px; font-size:8.5pt; color:#888; font-style:italic; }
    .demo-badge { position:absolute; top:8px; right:8px; background:${accentColor}; color:${primaryColor}; font-size:7.5pt; font-weight:800; padding:3px 10px; border-radius:3px; letter-spacing:1px; text-transform:uppercase; }
  </style></head><body><div class="page">
  <div class="demo-badge">Demo Preview</div>
  <div class="accent-bar"></div>
  <div class="header">
    <div class="header-image-slot">${headerLeftUrl ? `<img src="${headerLeftUrl}" />` : ''}</div>
    <div class="header-text">
      <div class="company-name">${esc(companyName)}</div>
      <div class="tagline">${esc(tagline)}</div>
      ${contactLine ? `<div class="contact-line">${contactLine}</div>` : ''}
      ${addressLine ? `<div class="address-line">${esc(addressLine)}</div>` : ''}
    </div>
    <div class="header-image-slot">${headerRightUrl ? `<img src="${headerRightUrl}" />` : ''}</div>
  </div>
  <div class="info-grid">
    <div class="info-col"><table>
      <tr><td class="label">M/s.:</td><td class="strong">Demo Customer</td></tr>
      <tr><td class="label">Address:</td><td>123 Sample Road, Mumbai</td></tr>
      <tr><td class="label">Phone:</td><td>9876543210</td></tr>
      <tr><td class="label">GST No.:</td><td>${form.gstNumber ? esc(form.gstNumber) : '27AABCU9603R1ZP'}</td></tr>
    </table></div>
    <div class="info-col"><table>
      <tr><td class="label">Bill No.:</td><td class="strong">${form.nextInvoiceNumber || 1}</td></tr>
      <tr><td class="label">Date:</td><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
      <tr><td class="label">Total Trips:</td><td>3</td></tr>
    </table></div>
  </div>
  <table class="tt"><thead><tr>
    <th style="width:15%;">Date</th><th class="l" style="width:25%;">Pickup</th><th class="l" style="width:25%;">Drop</th><th class="r" style="width:17.5%;">Paid</th><th class="r" style="width:17.5%;">Amount</th>
  </tr></thead><tbody>${rowsHtml}</tbody><tfoot>
    <tr class="subtotal-row"><td colspan="3" class="r">Sub Total</td><td class="r">₹1,500.00</td><td class="r">₹23,700.00</td></tr>
  </tfoot></table>
  <div class="words-row">
    <div class="words-col"><div class="words-box"><b>Amount in Words:</b> Twenty Three Thousand Seven Hundred Rupees Only</div></div>
    ${upiQrUrl ? `<div class="upi-qr-box"><img src="${upiQrUrl}" alt="UPI QR" /></div>` : ''}
  </div>
  <div class="footer-row">
    <div class="bank-col">
      <div class="bank-title">BANK DETAILS</div>
      <table>
        <tr><td class="label">Bank Name:</td><td>${esc(bank?.bankName || 'State Bank of India')}</td></tr>
        <tr><td class="label">Branch:</td><td>${esc(bank?.bankBranch || 'Main Branch')}</td></tr>
        <tr><td class="label">Account No:</td><td class="strong">${esc(bank?.accountNumber || '1234567890')}</td></tr>
        <tr><td class="label">IFSC Code:</td><td class="strong">${esc(bank?.ifscCode || 'SBIN0001234')}</td></tr>
      </table>
    </div>
    <div class="sign-col">
      <div class="for-company">For ${esc(companyName)}</div>
      ${signatureUrl ? `<img src="${signatureUrl}" class="sign-img" />` : '<div style="height:38px;"></div>'}
      <div class="sign-line">Authorized Signatory</div>
    </div>
  </div>
  <div class="footer-note">${esc(form.footerNote || 'Thank you for your business!')}</div>
</div></body></html>`;
}

const newBankAccount = (): BankAccount => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: '', bankName: '', bankBranch: '', accountNumber: '', ifscCode: '',
});

const BrandingSettings = () => {
  const theme = useTheme();
  const toast = useToast();
  const { branding, updateBranding, user, updateMyEmail } = useAppContext();
  const [form, setForm] = useState<Branding>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [signatureProcessing, setSignatureProcessing] = useState(false);
  const [signatureError, setSignatureError] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState(user?.email || '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [headerImageProcessing, setHeaderImageProcessing] = useState<HeaderImageField | null>(null);
  const [headerImageError, setHeaderImageError] = useState('');
  const [cropTarget, setCropTarget] = useState<{ field: HeaderImageField; image: HTMLImageElement } | null>(null);
  const [upiQrProcessing, setUpiQrProcessing] = useState(false);
  const [upiQrError, setUpiQrError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (branding) setForm({ ...branding, bankAccounts: branding.bankAccounts || [] });
  }, [branding]);

  useEffect(() => {
    setRecoveryEmail(user?.email || '');
  }, [user?.email]);

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    setEmailMessage(null);
    try {
      await updateMyEmail(recoveryEmail.trim());
      toast.success('Recovery email saved.');
    } catch (error) {
      setEmailMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save' });
    } finally {
      setSavingEmail(false);
    }
  };

  const addBankAccount = () => setForm(prev => ({ ...prev, bankAccounts: [...prev.bankAccounts, newBankAccount()] }));
  const updateBankAccount = (id: string, key: keyof BankAccount, value: string) =>
    setForm(prev => ({
      ...prev,
      bankAccounts: prev.bankAccounts.map(acc => (acc.id === id ? { ...acc, [key]: value } : acc)),
    }));
  const removeBankAccount = (id: string) =>
    setForm(prev => ({ ...prev, bankAccounts: prev.bankAccounts.filter(acc => acc.id !== id) }));

  const update = (key: keyof Branding, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSignatureUpload = async (e: ChangeEvent<HTMLInputElement>, mode: 'photo' | 'scan') => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires onChange
    if (!file) return;
    setSignatureProcessing(true);
    setSignatureError('');
    try {
      const dataUrl = mode === 'scan' ? await processSignatureScan(file) : await processSignaturePhoto(file);
      setForm(prev => ({ ...prev, signatureDataUrl: dataUrl }));
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : 'Could not process that image');
    } finally {
      setSignatureProcessing(false);
    }
  };

  const handleHeaderImageUpload = async (e: ChangeEvent<HTMLInputElement>, field: HeaderImageField) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setHeaderImageError('');
    setHeaderImageProcessing(field);
    try {
      const img = await fileToImage(file);
      if (needsManualCrop(img)) {
        // Shape doesn't match the slot closely enough for an automatic center-crop to be safe —
        // let the admin choose what part of the image stays in frame.
        setCropTarget({ field, image: img });
      } else {
        setForm(prev => ({ ...prev, [field]: autoFitHeaderImage(img) }));
      }
    } catch (error) {
      setHeaderImageError(error instanceof Error ? error.message : 'Could not process that image');
    } finally {
      setHeaderImageProcessing(null);
    }
  };

  const handleCropConfirm = (crop: { x: number; y: number; width: number; height: number }) => {
    if (!cropTarget) return;
    const dataUrl = renderHeaderImageCrop(cropTarget.image, crop);
    setForm(prev => ({ ...prev, [cropTarget.field]: dataUrl }));
    setCropTarget(null);
  };

  const handleUpiQrUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUpiQrError('');
    setUpiQrProcessing(true);
    try {
      const dataUrl = await processUpiQrImage(file);
      setForm(prev => ({ ...prev, upiQrImageDataUrl: dataUrl }));
    } catch (error) {
      setUpiQrError(error instanceof Error ? error.message : 'Could not process that image');
    } finally {
      setUpiQrProcessing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateBranding(form);
      // Success is transient (toast) — nothing here needs the admin's ongoing attention once it
      // works. An error stays as a persistent inline Alert below, since that one DOES need
      // acting on rather than fading away after a few seconds.
      toast.success('Bill branding saved.');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h5" sx={{ color: '#F0B90B', fontWeight: 800 }}>Bill Branding &amp; Settings</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          This is what appears on every invoice you print or share.
        </Typography>
      </Paper>

      {user?.role === 'admin' && (
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Security sx={{ color: '#F0B90B', fontSize: 20 }} />
            <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700 }}>Account Security</Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Add a recovery email so you can reset your own password from the login screen if you ever forget it.
          </Typography>
          {emailMessage && <Alert severity={emailMessage.type} sx={{ mb: 2 }}>{emailMessage.text}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Recovery Email"
              type="email"
              value={recoveryEmail}
              onChange={e => setRecoveryEmail(e.target.value)}
              fullWidth
            />
            <Button
              variant="contained"
              onClick={handleSaveEmail}
              disabled={savingEmail || recoveryEmail.trim() === (user?.email || '')}
              sx={{ color: 'primary.contrastText', fontWeight: 800, whiteSpace: 'nowrap' }}
            >
              {savingEmail ? 'Saving...' : 'Save Email'}
            </Button>
          </Stack>
        </Paper>
      )}

      {message && <Alert severity={message.type}>{message.text}</Alert>}

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 2 }}>Company Details</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField label="Company Name" value={form.companyName} onChange={e => update('companyName', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Tagline" value={form.tagline} onChange={e => update('tagline', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Proprietor Name" value={form.proprietorName} onChange={e => update('proprietorName', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField label="Phone 1" value={form.phone1} onChange={e => update('phone1', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField label="Phone 2 (optional)" value={form.phone2} onChange={e => update('phone2', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Address" value={form.address} onChange={e => update('address', e.target.value)} fullWidth multiline rows={2} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Your GST Number (optional)" value={form.gstNumber} onChange={e => update('gstNumber', e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Invoice Footer Note" value={form.footerNote} onChange={e => update('footerNote', e.target.value)} fullWidth />
          </Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 2 }}>Bill Theme Colors</Typography>
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Primary Color (header / accents)</Typography>
            <input
              type="color"
              value={form.primaryColor}
              onChange={e => update('primaryColor', e.target.value)}
              style={{ width: 64, height: 40, border: `1px solid ${theme.palette.divider}`, borderRadius: 6, background: 'none', cursor: 'pointer' }}
            />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Accent Color (highlights / badge)</Typography>
            <input
              type="color"
              value={form.accentColor}
              onChange={e => update('accentColor', e.target.value)}
              style={{ width: 64, height: 40, border: `1px solid ${theme.palette.divider}`, borderRadius: 6, background: 'none', cursor: 'pointer' }}
            />
          </Box>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 1 }}>Header Logos</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Optional images shown to the left and right of "{form.companyName || 'your company name'}" at the top of every
          printed bill. Both slots share the same fixed shape — if your image doesn't already match it, you'll get a
          quick crop step to fit it in; only what's inside the frame gets uploaded.
        </Typography>
        {headerImageError && <Alert severity="error" sx={{ mb: 2 }}>{headerImageError}</Alert>}
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          {([
            { field: 'headerLeftImageDataUrl' as HeaderImageField, label: 'Left Image' },
            { field: 'headerRightImageDataUrl' as HeaderImageField, label: 'Right Image' },
          ]).map(({ field, label }) => (
            <Box key={field}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>{label}</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start' }}>
                {form[field] ? (
                  <Box sx={{ p: 1, bgcolor: '#fff', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: HEADER_IMAGE_PREVIEW_WIDTH, height: HEADER_IMAGE_PREVIEW_HEIGHT }}>
                    <img src={form[field]} alt={label} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                  </Box>
                ) : (
                  <Box sx={{ border: `1px dashed ${theme.palette.divider}`, borderRadius: 2, width: HEADER_IMAGE_PREVIEW_WIDTH, height: HEADER_IMAGE_PREVIEW_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ImageIcon sx={{ color: 'text.secondary' }} />
                  </Box>
                )}
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    component="label"
                    startIcon={<PhotoCamera />}
                    disabled={headerImageProcessing === field}
                  >
                    {headerImageProcessing === field ? 'Processing...' : form[field] ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/*" hidden onChange={e => handleHeaderImageUpload(e, field)} />
                  </Button>
                  {form[field] && (
                    <Button size="small" variant="text" color="error" onClick={() => update(field, '')}>
                      Remove
                    </Button>
                  )}
                </Stack>
              </Box>
            </Box>
          ))}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 1 }}>Authorized Signature</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Upload once and it'll appear above "Authorized Signatory" on every printed bill. If you're uploading a
          photo of a signature on paper, use "Remove Background" so only the ink shows through — otherwise the
          paper's white/cream background prints as a visible box. Automatically resized and compressed on upload,
          so any phone photo works — no need to crop or shrink it yourself first.
        </Typography>
        {signatureError && <Alert severity="error" sx={{ mb: 2 }}>{signatureError}</Alert>}
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          {form.signatureDataUrl ? (
            <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 220, height: 110 }}>
              <img src={form.signatureDataUrl} alt="Signature" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </Box>
          ) : (
            <Box sx={{ border: `1px dashed ${theme.palette.divider}`, borderRadius: 2, width: 220, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>No signature uploaded</Typography>
            </Box>
          )}
          <Stack spacing={1}>
            <Button variant="outlined" component="label" startIcon={<PhotoCamera />} disabled={signatureProcessing}>
              Upload as Photo
              <input type="file" accept="image/*" hidden onChange={e => handleSignatureUpload(e, 'photo')} />
            </Button>
            <Button variant="outlined" component="label" startIcon={<AutoFixHigh />} disabled={signatureProcessing}>
              Upload &amp; Remove Background
              <input type="file" accept="image/*" hidden onChange={e => handleSignatureUpload(e, 'scan')} />
            </Button>
            {form.signatureDataUrl && (
              <Button variant="text" color="error" onClick={() => update('signatureDataUrl', '')}>
                Remove Signature
              </Button>
            )}
          </Stack>
        </Box>
        {signatureProcessing && (
          <Typography variant="body2" sx={{ color: '#F0B90B', mt: 2 }}>Processing image...</Typography>
        )}

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 1 }}>UPI QR Code</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Optional payment scanner shown on every printed bill, next to "Amount in Words" below Net Payable.
          Never cropped — the whole code is kept intact so it stays scannable.
        </Typography>
        {upiQrError && <Alert severity="error" sx={{ mb: 2 }}>{upiQrError}</Alert>}
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          {form.upiQrImageDataUrl ? (
            <Box sx={{ p: 1, bgcolor: '#fff', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 140, height: 140 }}>
              <img src={form.upiQrImageDataUrl} alt="UPI QR code" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </Box>
          ) : (
            <Box sx={{ border: `1px dashed ${theme.palette.divider}`, borderRadius: 2, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <QrCode2 sx={{ color: 'text.secondary', fontSize: 32 }} />
            </Box>
          )}
          <Stack spacing={1.5}>
            <Button variant="outlined" component="label" startIcon={<PhotoCamera />} disabled={upiQrProcessing} sx={{ alignSelf: 'flex-start' }}>
              {upiQrProcessing ? 'Processing...' : form.upiQrImageDataUrl ? 'Replace' : 'Upload QR Code'}
              <input type="file" accept="image/*" hidden onChange={handleUpiQrUpload} />
            </Button>
            {form.upiQrImageDataUrl && (
              <Button variant="text" color="error" onClick={() => update('upiQrImageDataUrl', '')} sx={{ alignSelf: 'flex-start' }}>
                Remove QR Code
              </Button>
            )}
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="upi-qr-show-on-label">Show on</InputLabel>
              <Select
                labelId="upi-qr-show-on-label"
                label="Show on"
                value={form.upiQrShowOn}
                onChange={(e: SelectChangeEvent) => update('upiQrShowOn', e.target.value)}
              >
                <MenuItem value="both">Both GST &amp; Non-GST bills</MenuItem>
                <MenuItem value="gst">GST bills only</MenuItem>
                <MenuItem value="non-gst">Non-GST bills only</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700 }}>Bank Accounts</Typography>
          <Button size="small" startIcon={<Add />} onClick={addBankAccount} sx={{ color: '#F0B90B', fontWeight: 700 }}>
            Add Account
          </Button>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Add every account you receive payments into. When generating a customer's bill, you'll pick which one
          to print — handy since a bill doesn't always go to the same account.
        </Typography>

        {form.bankAccounts.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, border: `1px dashed ${theme.palette.divider}`, borderRadius: 2 }}>
            <AccountBalance sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No bank accounts saved yet. Click "Add Account" to add your first one.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            {form.bankAccounts.map((account, index) => (
              <Box
                key={account.id}
                sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', border: `1px solid ${theme.palette.divider}`, position: 'relative' }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ color: '#F0B90B', fontWeight: 700 }}>
                    Account {index + 1}
                  </Typography>
                  <IconButton size="small" onClick={() => removeBankAccount(account.id)} sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Label (e.g. SBI - Main Account)"
                      value={account.label}
                      onChange={e => updateBankAccount(account.id, 'label', e.target.value)}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Bank Name"
                      value={account.bankName}
                      onChange={e => updateBankAccount(account.id, 'bankName', e.target.value)}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Branch"
                      value={account.bankBranch}
                      onChange={e => updateBankAccount(account.id, 'bankBranch', e.target.value)}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Account Number"
                      value={account.accountNumber}
                      onChange={e => updateBankAccount(account.id, 'accountNumber', e.target.value)}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="IFSC Code"
                      value={account.ifscCode}
                      onChange={e => updateBankAccount(account.id, 'ifscCode', e.target.value)}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                </Grid>
              </Box>
            ))}
          </Stack>
        )}

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <Button variant="outlined" startIcon={<Receipt />} onClick={() => setShowPreview(p => !p)} sx={{ fontWeight: 700 }}>
            {showPreview ? 'Hide Preview' : 'Bill Preview'}
          </Button>
          <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={saving} sx={{ color: 'primary.contrastText', fontWeight: 800 }}>
            {saving ? 'Saving...' : 'Save Branding'}
          </Button>
        </Box>
      </Paper>

      {showPreview && (
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, mb: 1 }}>Bill Preview</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            This is how your bill will look with demo data. Your uploaded logo, signature, bank details, and branding colors are shown as they'll appear on a real invoice.
          </Typography>
          <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
            <iframe
              title="Bill Preview"
              srcDoc={buildDemoBillHtml(form)}
              style={{ width: '100%', height: 820, border: 'none', display: 'block' }}
            />
          </Box>
        </Paper>
      )}

      <ImageCropDialog
        open={Boolean(cropTarget)}
        image={cropTarget?.image || null}
        aspect={HEADER_IMAGE_ASPECT}
        title={cropTarget?.field === 'headerLeftImageDataUrl' ? 'Position Left Image' : 'Position Right Image'}
        onCancel={() => setCropTarget(null)}
        onConfirm={handleCropConfirm}
      />

      <LoadingOverlay open={saving} label="Saving bill branding…" />
    </Box>
  );
};

export default BrandingSettings;
