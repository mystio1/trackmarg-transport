import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Printer } from '@capgo/capacitor-printer';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Paper,
  GridLegacy as Grid ,
  Card,
  CardContent,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  useMediaQuery,
  useTheme,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowBack,
  Phone,
  LocationOn,
  LocalShipping,
  AccountBalanceWallet,
  ErrorOutline,
  Receipt,
  Close,
  Print,
  Share as ShareIcon,
  Email,
  WhatsApp,
  FilterAlt,
  Clear,
  Add,
  Edit,
  Delete,
  Bookmark,
  ExpandMore,
  Savings,
} from '@mui/icons-material';
import type { Trip } from '../types';
import { useAppContext } from '../context/AppContext';
import TripList from '../components/TripList';
import { DetailPageSkeleton } from '../components/Skeletons';
import { useToast } from '../components/ToastProvider';
import LoadingOverlay from '../components/LoadingOverlay';
import { renderBillNodeToA4Pdf } from '../utils/billPdf';
import { shouldShowUpiQr } from '../utils/upiQrImage';
import { findSimilarName } from '../utils/similarity';
import { useFitPreviewToViewport } from '../hooks/useFitPreviewToViewport';

// `Date.toISOString()` converts to UTC first, so late-evening local time (e.g. IST, UTC+5:30)
// rolls over to "tomorrow" in UTC before slicing — a date <input> defaulting off of that shows
// the wrong day for several hours around local midnight. This reads the LOCAL calendar date instead.
const todayLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const CustomerDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const {
    customers, getCustomerTrips, updateTripPaymentStatus, isLoading,
    branding, updateCustomer, getNextInvoiceNumber, sendBillEmail,
    addCustomerAdvance, deleteCustomerAdvance, permanentlyDeleteCustomerAdvance, mergeCustomer, saveBill,
    checkBillGenerationLimit,
  } = useAppContext();
  const toast = useToast();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const triedRedirect = useRef(false);
  // Add a state to track if data is loaded
  const [dataLoaded, setDataLoaded] = useState(false);

  // State for GST numbers (optional)
  const [customerGst, setCustomerGst] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayLocalDateString());
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [amountInWords, setAmountInWords] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [tripFilterFrom, setTripFilterFrom] = useState('');
  const [tripFilterTo, setTripFilterTo] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [dialogMessage, setDialogMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit customer (name/phone/address) + similar-name collision handling
  const [isEditCustomerOpen, setIsEditCustomerOpen] = useState(false);
  const [editCustomerForm, setEditCustomerForm] = useState({ name: '', phone: '', address: '' });
  const [savingCustomerEdit, setSavingCustomerEdit] = useState(false);
  const [collisionMatch, setCollisionMatch] = useState<{ id: string; name: string } | null>(null);
  const [pendingCustomerEdit, setPendingCustomerEdit] = useState<{ name: string; phone: string; address: string } | null>(null);
  const [mergingCustomer, setMergingCustomer] = useState(false);

  // Advance balance (money the customer already paid ahead of any specific trip)
  const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
  const [advanceAmountInput, setAdvanceAmountInput] = useState('');
  const [advanceNote, setAdvanceNote] = useState('');
  const [advanceDateInput, setAdvanceDateInput] = useState(todayLocalDateString());
  const [savingAdvance, setSavingAdvance] = useState(false);
  const [isAdvanceHistoryOpen, setIsAdvanceHistoryOpen] = useState(false);
  const [deleteAdvanceEntry, setDeleteAdvanceEntry] = useState<{ id: string; amount: number; note: string } | null>(null);
  const [deletingAdvance, setDeletingAdvance] = useState(false);
  const [permanentDeleteEntry, setPermanentDeleteEntry] = useState<{ id: string; amount: number; note: string } | null>(null);
  const [permanentlyDeletingAdvance, setPermanentlyDeletingAdvance] = useState(false);

  // Advance Balance dialog — search + amount-range + date (specific or range) filters
  const [advanceSearchTerm, setAdvanceSearchTerm] = useState('');
  const [advanceAmountMin, setAdvanceAmountMin] = useState('');
  const [advanceAmountMax, setAdvanceAmountMax] = useState('');
  const [advanceDateFrom, setAdvanceDateFrom] = useState('');
  const [advanceDateTo, setAdvanceDateTo] = useState('');

  // "Download Bill" (single trip) — if the customer has an advance balance, ask first whether
  // it should be applied to that trip's bill before generating it.
  const [tripBillAdvancePrompt, setTripBillAdvancePrompt] = useState<Trip | null>(null);

  // Discount (optional, applied to the bill's sub total before GST)
  const [discountAmount, setDiscountAmount] = useState('');

  // GST vs Non-GST bill choice — asked whenever "View & Print Bill" is clicked
  const [isBillTypeDialogOpen, setIsBillTypeDialogOpen] = useState(false);
  const [billTypeChoice, setBillTypeChoice] = useState<'non-gst' | 'gst'>('non-gst');
  const [isGstBill, setIsGstBill] = useState(false);
  const [gstPercent, setGstPercent] = useState('');
  const [gstBillNoInput, setGstBillNoInput] = useState('');
  const [billTypeError, setBillTypeError] = useState('');
  // Which payment status to include in the generated bill — asked alongside the GST/Non-GST
  // choice. Defaults to "all" (both paid and unpaid trips), same as before this filter existed.
  const [billPaymentFilter, setBillPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all');

  // Ref for the bill section
  const billRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewSizerRef = useRef<HTMLDivElement>(null);
  // Only on the fullscreen mobile/native preview — on desktop the sheet already fits comfortably
  // at its natural 194mm width, so this stays a no-op there.
  useFitPreviewToViewport(
    previewViewportRef, previewSizerRef, previewRef,
    isPreviewOpen && (Capacitor.isNativePlatform() || isSmallScreen),
  );
  const [sharingBill, setSharingBill] = useState(false);
  const [savingBillRecord, setSavingBillRecord] = useState(false);
  const [printingBill, setPrintingBill] = useState(false);
  const [saveBillPrompt, setSaveBillPrompt] = useState<{ action: 'print' | 'whatsapp' | 'email' } | null>(null);
  const [saveBillPromptBillNo, setSaveBillPromptBillNo] = useState('');

  // Find customer by ID
  const customer = customers.find(c => c.id === id);

  // If we have an ID but no customers loaded yet, don't redirect immediately
  const shouldShowLoading = id && (customers.length === 0 || isLoading) && !dataLoaded;
  
  // Update the useEffect to set dataLoaded when customers are loaded
  useEffect(() => {
    if (customers.length > 0) {
      setDataLoaded(true);
    }
  }, [customers]);

  useEffect(() => {
    if (dataLoaded && !customer && !triedRedirect.current) {
      triedRedirect.current = true;
      navigate('/');
    }
  }, [customer, dataLoaded, navigate]);
  
  // Refresh effect (if needed for your context/store)
  useEffect(() => {
    // This effect will run whenever refreshTrigger or id changes
    // If you need to reload data from a server or context, do it here
  }, [refreshTrigger, id]);

  // Prefill GST from the saved customer record, and bank details from the admin's branding
  // settings, so the bill doesn't rely on hardcoded test data.
  useEffect(() => {
    if (customer?.gstNumber) setCustomerGst(customer.gstNumber);
  }, [customer?.gstNumber]);

  // Default to the first saved bank account (admin picks a different one from the dropdown
  // below if this bill should go on a different account).
  useEffect(() => {
    if (selectedBankAccountId) return;
    const first = branding?.bankAccounts?.[0];
    if (!first) return;
    setSelectedBankAccountId(first.id);
    setBankName(first.bankName);
    setBranch(first.bankBranch);
    setAccountNumber(first.accountNumber);
    setIfscCode(first.ifscCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding]);

  const handleSelectBankAccount = (accountId: string) => {
    setSelectedBankAccountId(accountId);
    const account = branding?.bankAccounts?.find(a => a.id === accountId);
    setBankName(account?.bankName || '');
    setBranch(account?.bankBranch || '');
    setAccountNumber(account?.accountNumber || '');
    setIfscCode(account?.ifscCode || '');
  };

  // Handle back navigation
  const handleBack = () => {
    navigate('/');
  };

  // Show a skeleton (not a blank "Loading..." message) while data is still loading
  if (shouldShowLoading) {
    return <DetailPageSkeleton />;
  }
  
  // If customer not found, show error message
  if (!customer) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <ErrorOutline sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom color="error.main">
          Customer Not Found
        </Typography>
        <Typography variant="body1" sx={{ mb: 4 }}>
          The customer you are looking for does not exist or has been removed.
        </Typography>
        <Button
          variant="contained"
          startIcon={<ArrowBack />}
          onClick={handleBack}
        >
          Back to Home
        </Button>
      </Box>
    );
  }

  // Get customer trips, narrowed to the From/To date filter when one is set. Shadowing
  // `customerTrips` here (rather than introducing a separate name) means every existing usage
  // below — stats, bill preview, print/WhatsApp/email, trip history — picks up the filter for free.
  const allCustomerTrips = getCustomerTrips(id || '');
  const isDateFiltered = Boolean(tripFilterFrom || tripFilterTo);
  const customerTrips = isDateFiltered
    ? allCustomerTrips.filter(trip => {
        const tripTime = new Date(trip.date).getTime();
        if (tripFilterFrom && tripTime < new Date(tripFilterFrom).getTime()) return false;
        if (tripFilterTo && tripTime > new Date(tripFilterTo).getTime() + 86399999) return false;
        return true;
      })
    : allCustomerTrips;

  // Trips that actually go into the generated bill — same date filter as above, further narrowed
  // by the paid/unpaid choice made alongside GST/Non-GST. Kept separate from `customerTrips` so
  // the page's own stat cards and Trip History list still show everything in the date range
  // regardless of which subset is being billed right now.
  const billTrips = billPaymentFilter === 'all'
    ? customerTrips
    : customerTrips.filter(trip => (billPaymentFilter === 'paid' ? trip.isPaid : !trip.isPaid));

  // Calculate statistics
  const totalTrips = customerTrips.length;
  
  const totalAmount = customerTrips.reduce((sum, trip) => {
    const amount = typeof trip.amount === 'number' ? trip.amount : parseFloat(trip.amount) || 0;
    return sum + amount;
  }, 0);
  
  const paidAmount = customerTrips
    .filter(trip => trip.isPaid)
    .reduce((sum, trip) => {
      const amount = typeof trip.amount === 'number' ? trip.amount : parseFloat(trip.amount) || 0;
      return sum + amount;
    }, 0);
    
  const pendingAmount = totalAmount - paidAmount;

  // Handle back navigation
  const handleBackToHome = () => {
    navigate('/');
  };

  // Handle payment status update
  const handlePaymentStatusUpdate = (tripId: string, isPaid: boolean) => {
    updateTripPaymentStatus(tripId, isPaid);
    setRefreshTrigger(prev => prev + 1);
  };

  // ── Edit customer name/phone/address ────────────────────────────────────
  const openEditCustomer = () => {
    if (!customer) return;
    setEditCustomerForm({ name: customer.name, phone: customer.phone, address: customer.address });
    setIsEditCustomerOpen(true);
  };

  const saveCustomerFields = async (data: { name: string; phone: string; address: string }) => {
    if (!customer) return;
    setSavingCustomerEdit(true);
    try {
      await updateCustomer(customer.id, data);
      setIsEditCustomerOpen(false);
    } finally {
      setSavingCustomerEdit(false);
    }
  };

  const handleSaveCustomerEdit = async () => {
    if (!customer) return;
    const name = editCustomerForm.name.trim();
    if (!name) return;
    const data = { name, phone: editCustomerForm.phone.trim(), address: editCustomerForm.address.trim() };
    // Only worth checking for a near-duplicate when the name actually changed to something new.
    if (name.toLowerCase() !== customer.name.toLowerCase()) {
      const match = findSimilarName(name, customers, customer.id);
      if (match) {
        setCollisionMatch(match);
        setPendingCustomerEdit(data);
        return;
      }
    }
    await saveCustomerFields(data);
  };

  const handleMergeIntoExisting = async () => {
    if (!customer || !collisionMatch) return;
    setMergingCustomer(true);
    try {
      await mergeCustomer(customer.id, collisionMatch.id);
      setCollisionMatch(null);
      setPendingCustomerEdit(null);
      setIsEditCustomerOpen(false);
      navigate(`/customer/${collisionMatch.id}`);
    } finally {
      setMergingCustomer(false);
    }
  };

  const handleKeepAsSeparateCustomer = async () => {
    if (!pendingCustomerEdit) return;
    await saveCustomerFields(pendingCustomerEdit);
    setCollisionMatch(null);
    setPendingCustomerEdit(null);
  };

  // ── Advance balance (money paid ahead of any specific trip) ─────────────
  const openAddAdvanceDialog = () => {
    setAdvanceDateInput(todayLocalDateString());
    setIsAdvanceDialogOpen(true);
  };

  const handleAddAdvance = async () => {
    if (!customer) return;
    const amount = Number(advanceAmountInput);
    if (!amount || amount <= 0) return;
    setSavingAdvance(true);
    try {
      await addCustomerAdvance(customer.id, amount, advanceNote.trim(), advanceDateInput);
      setIsAdvanceDialogOpen(false);
      setAdvanceAmountInput('');
      setAdvanceNote('');
    } finally {
      setSavingAdvance(false);
    }
  };

  const handleConfirmDeleteAdvance = async () => {
    if (!customer || !deleteAdvanceEntry) return;
    setDeletingAdvance(true);
    try {
      await deleteCustomerAdvance(customer.id, deleteAdvanceEntry.id);
      setDeleteAdvanceEntry(null);
    } finally {
      setDeletingAdvance(false);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!customer || !permanentDeleteEntry) return;
    setPermanentlyDeletingAdvance(true);
    try {
      await permanentlyDeleteCustomerAdvance(customer.id, permanentDeleteEntry.id);
      setPermanentDeleteEntry(null);
    } finally {
      setPermanentlyDeletingAdvance(false);
    }
  };

  const convertNumberToWords = (num: number): string => {
    const units = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const convertHundreds = (value: number): string => {
      let words = '';
      if (value >= 100) {
        words += `${units[Math.floor(value / 100)]} Hundred `;
        value %= 100;
      }
      if (value >= 20) {
        words += `${tens[Math.floor(value / 10)]} `;
        if (value % 10) words += `${units[value % 10]} `;
      } else if (value >= 10) {
        words += `${teens[value - 10]} `;
      } else if (value > 0) {
        words += `${units[value]} `;
      }
      return words.trim();
    };

    const sections = [];
    const crore = Math.floor(num / 10000000);
    const lakh = Math.floor((num % 10000000) / 100000);
    const thousand = Math.floor((num % 100000) / 1000);
    const remainder = num % 1000;

    if (crore) sections.push(`${convertHundreds(crore)} Crore`);
    if (lakh) sections.push(`${convertHundreds(lakh)} Lakh`);
    if (thousand) sections.push(`${convertHundreds(thousand)} Thousand`);
    if (remainder) sections.push(`${convertHundreds(remainder)}`);
    return sections.length ? sections.join(' ') : 'Zero';
  };

  // Computes every figure the bill needs — sub total, optional discount, optional GST (applied
  // to the discounted sub total), amount already received per-trip, and the customer's available
  // advance balance auto-applied against whatever is still outstanding after GST. Nothing here is
  // persisted: it's a live, view-time calculation so opening the bill repeatedly never double-spends
  // the advance wallet — it only actually leaves the wallet when settled via Record Payment.
  const getBillTotals = (trips: typeof customerTrips, overrides?: { discount?: number; gstEnabled?: boolean; gstPercent?: number; applyAdvance?: boolean }) => {
    const subTotal = trips.reduce((sum, t) => {
      const amt = typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount)) || 0;
      return sum + amt;
    }, 0);
    const received = trips.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
    const discount = Math.max(0, overrides?.discount ?? (Number(discountAmount) || 0));
    const gstEnabled = overrides?.gstEnabled ?? isGstBill;
    const gstPct = gstEnabled ? (overrides?.gstPercent ?? (Number(gstPercent) || 0)) : 0;
    const taxable = Math.max(0, subTotal - discount);
    const gstAmount = gstEnabled ? (taxable * gstPct) / 100 : 0;
    const grandTotal = taxable + gstAmount;
    const outstanding = Math.max(0, grandTotal - received);
    const advanceAvailable = (overrides?.applyAdvance ?? true) ? Math.max(0, customer?.advanceBalance || 0) : 0;
    const advanceApplied = Math.min(advanceAvailable, outstanding);
    const netPayable = outstanding - advanceApplied;
    const showBreakdown = discount > 0 || gstEnabled || received > 0 || advanceApplied > 0;
    return { subTotal, received, discount, gstEnabled, gstPct, gstAmount, grandTotal, outstanding, advanceApplied, advanceAvailable, netPayable, showBreakdown };
  };

  // Opens the bill preview. Assigns a real, server-issued invoice number the first time
  // (instead of always defaulting to "01"), and saves any GST number entered here onto the
  // customer record so it's remembered next time.
  const handleOpenPreview = async () => {
    if (!billNo) {
      try {
        const nextNumber = await getNextInvoiceNumber();
        setBillNo(String(nextNumber));
      } catch (error) {
        console.error('Could not fetch next invoice number:', error);
      }
    }
    if (customer && customerGst.trim() && customerGst.trim() !== (customer.gstNumber || '')) {
      updateCustomer(customer.id, { gstNumber: customerGst.trim() }).catch(err =>
        console.error('Could not save customer GST number:', err)
      );
    }
    setIsPreviewOpen(true);
  };

  // "View & Print Bill" now opens this chooser first — Non-GST keeps today's behaviour exactly
  // (auto invoice number, plain total), GST asks for the percentage plus a manually-entered bill
  // number (kept separate from the app's own auto-incrementing counter, since GST invoices
  // typically run on their own numbering series).
  const openBillTypeDialog = () => {
    setBillTypeChoice(isGstBill ? 'gst' : 'non-gst');
    setGstBillNoInput(isGstBill ? billNo : '');
    setBillTypeError('');
    setIsBillTypeDialogOpen(true);
  };

  const handleBillTypeContinue = async () => {
    if (billTrips.length === 0) {
      setBillTypeError('No trips match this date range and payment filter — adjust them to include at least one trip.');
      return;
    }
    if (billTypeChoice === 'non-gst') {
      setIsGstBill(false);
      setGstPercent('');
      setIsBillTypeDialogOpen(false);
      await handleOpenPreview();
      return;
    }
    const pct = Number(gstPercent);
    if (!gstPercent || pct <= 0) {
      setBillTypeError('Enter a valid GST percentage.');
      return;
    }
    if (!gstBillNoInput.trim()) {
      setBillTypeError('Enter the bill number for this GST invoice.');
      return;
    }
    setIsGstBill(true);
    setBillNo(gstBillNoInput.trim());
    setIsBillTypeDialogOpen(false);
    setBillTypeError('');
    if (customer && customerGst.trim() && customerGst.trim() !== (customer.gstNumber || '')) {
      updateCustomer(customer.id, { gstNumber: customerGst.trim() }).catch(err =>
        console.error('Could not save customer GST number:', err)
      );
    }
    setIsPreviewOpen(true);
  };

  const buildBillText = () => {
    const company = branding?.companyName || 'Transport Manager';
    const totals = getBillTotals(billTrips);
    const lineBreak = '─'.repeat(40);
    const tripLines = billTrips.map((trip, i) =>
      `${i + 1}. ${new Date(trip.date).toLocaleDateString('en-IN')} | ${trip.pickupLocation} → ${trip.dropLocation}\n   Amount: Rs.${trip.amount.toFixed(2)}  Paid: Rs.${(trip.paidAmount || 0).toFixed(2)}`
    ).join('\n');
    const phones = [branding?.phone1, branding?.phone2].filter(Boolean).join(' / ');

    const breakdownLines = [
      `Sub Total:      Rs. ${totals.subTotal.toFixed(2)}`,
      totals.discount > 0 ? `Discount:      -Rs. ${totals.discount.toFixed(2)}` : '',
      totals.gstEnabled ? `GST (${totals.gstPct}%):     +Rs. ${totals.gstAmount.toFixed(2)}` : '',
      (totals.discount > 0 || totals.gstEnabled) ? `Grand Total:    Rs. ${totals.grandTotal.toFixed(2)}` : '',
      totals.received > 0 ? `Less: Received: -Rs. ${totals.received.toFixed(2)}` : '',
      totals.advanceApplied > 0 ? `Less: Advance:  -Rs. ${totals.advanceApplied.toFixed(2)}` : '',
      totals.showBreakdown ? `NET PAYABLE:    Rs. ${totals.netPayable.toFixed(2)}` : `TOTAL:          Rs. ${totals.subTotal.toFixed(2)}`,
      totals.advanceApplied > 0 ? `(Advance balance remaining: Rs. ${(totals.advanceAvailable - totals.advanceApplied).toFixed(2)})` : '',
    ].filter(Boolean).join('\n');

    return `${company.toUpperCase()}
${branding?.tagline || ''}
${branding?.proprietorName ? `Prop.: ${branding.proprietorName}` : ''}${phones ? `\nMob.: ${phones}` : ''}
${lineBreak}
${isGstBill ? 'TAX INVOICE' : 'INVOICE'}
${lineBreak}
Bill To: ${customer?.name}
Phone:   ${customer?.phone || 'N/A'}
Address: ${customer?.address || 'N/A'}
Bill No: ${billNo || '01'}    Date: ${billDate}
${lineBreak}
TRIP DETAILS:
${tripLines}
${lineBreak}
${breakdownLines}
${lineBreak}
${bankName ? `Bank: ${bankName}${branch ? ` | Branch: ${branch}` : ''}\n` : ''}${accountNumber ? `A/c: ${accountNumber}\n` : ''}${ifscCode ? `IFSC: ${ifscCode}\n` : ''}${lineBreak}
${branding?.footerNote || 'Thank you for your business!'}`;
  };

  const handleEmailBill = async () => {
    if (!customer?.email) return;
    setSendingEmail(true);
    setDialogMessage(null);
    try {
      await sendBillEmail(
        customer.email,
        `Invoice ${billNo || ''} from ${branding?.companyName || 'Transport Manager'}`,
        buildBillText(),
      );
      setDialogMessage({ type: 'success', text: `Bill emailed to ${customer.email}` });
    } catch (error) {
      setDialogMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not send email' });
    } finally {
      setSendingEmail(false);
    }
  };

  // Rasterizes the on-screen invoice preview and drops it into an A4 PDF — same visual layout
  // that's already rendered for the print path, just captured as an image instead of printed.
  const generateBillPdfBlob = async (): Promise<Blob> => {
    const node = previewRef.current;
    if (!node) throw new Error('Bill preview is not ready yet');
    return renderBillNodeToA4Pdf(node);
  };

  // WhatsApp button: shares the actual bill PDF (not a text summary) and, wherever the platform
  // allows it, opens WhatsApp's own contact picker instead of pre-targeting a specific number —
  // the admin picks who to send it to from inside WhatsApp, same as sharing any file normally.
  const handleWhatsAppBill = async () => {
    setSharingBill(true);
    setDialogMessage(null);
    try {
      if (customer) await checkBillGenerationLimit(customer.id, 'whatsapp');
      const blob = await generateBillPdfBlob();
      const fileName = `Invoice-${customer?.name || 'Bill'}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return;
      }

      // Desktop / browsers that can't share a file directly: download the PDF, then open
      // WhatsApp's contact-picker (no phone number baked in) so the admin can pick a contact
      // and manually attach the file WhatsApp itself has no web API for pre-attaching one.
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);

      window.open('https://wa.me/?text=' + encodeURIComponent(`Invoice for ${customer?.name || 'you'} — attaching the PDF I just downloaded.`), '_blank');
      setDialogMessage({ type: 'success', text: 'PDF downloaded and WhatsApp opened — pick a contact there and attach the downloaded file.' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return; // user cancelled the share sheet
      setDialogMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not share the bill' });
    } finally {
      setSharingBill(false);
    }
  };

  // Builds the printable invoice HTML for an arbitrary set of trips + totals — shared by the
  // main "Print / Save PDF" flow (the customer's filtered trip list) and the Trip History
  // per-trip "Download Bill" action (a single trip).
  const buildBillHtml = (
    tripsForBill: typeof customerTrips,
    opts: { billNoLabel: string; billDateLabel: string; totals: ReturnType<typeof getBillTotals>; amountWordsOverride?: string; docTitle?: string }
  ) => {
    const { totals } = opts;
    const amountWords = opts.amountWordsOverride?.trim() ||
      `${convertNumberToWords(Math.round(totals.showBreakdown ? totals.netPayable : totals.subTotal))} Rupees Only`;
    const escapeHtml = (value: string | number) =>
      String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    const printValue = (value: string | number | undefined) => escapeHtml(value || '');
    const bankNameToPrint = bankName.trim();
    const branchToPrint = branch.trim();
    const accountToPrint = accountNumber.trim();
    const ifscToPrint = ifscCode.trim();

    // Brand theme — set by the admin under Bill Branding & Settings (falls back to a default
    // navy/gold look if the admin hasn't customized it yet).
    const primaryColor = branding?.primaryColor || '#0B2B5E';
    const accentColor = branding?.accentColor || '#F0B90B';
    const companyName = (branding?.companyName || 'Transport Manager').toUpperCase();
    const tagline = branding?.tagline || 'Transport & Logistics Solutions';
    const proprietorLine = branding?.proprietorName ? `Prop.: ${branding.proprietorName}` : '';
    const phones = [branding?.phone1, branding?.phone2].filter(Boolean).join(' &nbsp;/&nbsp; ');
    const contactLine = [proprietorLine, phones ? `Mob.: ${phones}` : ''].filter(Boolean).join(' &nbsp;&nbsp;|&nbsp;&nbsp; ');
    const addressLine = branding?.address || '';
    const footerNote = branding?.footerNote || 'Thank you for your business!';
    const logoUrl = branding?.logoDataUrl || '';
    const signatureUrl = branding?.signatureDataUrl || '';
    const headerLeftUrl = branding?.headerLeftImageDataUrl || '';
    const headerRightUrl = branding?.headerRightImageDataUrl || '';
    const showUpiQr = shouldShowUpiQr(branding, isGstBill);
    const upiQrUrl = branding?.upiQrImageDataUrl || '';

    const rowsHtml = tripsForBill.map((trip, index) => {
      const bg = index % 2 === 0 ? '#fff' : '#fdf6f0';
      return `
        <tr style="background:${bg};">
          <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:center;">${printValue(new Date(trip.date).toLocaleDateString('en-IN'))}</td>
          <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;">${printValue(trip.pickupLocation)}</td>
          <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;">${printValue(trip.dropLocation)}</td>
          <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:right;">${printValue((trip.paidAmount || 0).toFixed(2))}</td>
          <td style="padding:5px 7px;border:1px solid #c8b8a2;font-size:9.5pt;text-align:right;">${printValue(trip.amount.toFixed(2))}</td>
        </tr>`;
    }).join('');

    const breakdownRowsHtml = `
      ${totals.discount > 0 ? `
      <tr class="discount-row">
        <td colspan="4" class="r">Discount</td>
        <td class="r">- ₹${printValue(totals.discount.toFixed(2))}</td>
      </tr>` : ''}
      ${totals.gstEnabled ? `
      <tr class="gst-row">
        <td colspan="4" class="r">GST (${printValue(totals.gstPct)}%)</td>
        <td class="r">+ ₹${printValue(totals.gstAmount.toFixed(2))}</td>
      </tr>` : ''}
      ${(totals.discount > 0 || totals.gstEnabled) ? `
      <tr class="grand-total-row">
        <td colspan="4" class="r">Grand Total</td>
        <td class="r">₹${printValue(totals.grandTotal.toFixed(2))}</td>
      </tr>` : ''}
      ${totals.received > 0 ? `
      <tr class="advance-row">
        <td colspan="4" class="r">Less: Amount Received</td>
        <td class="r">- ₹${printValue(totals.received.toFixed(2))}</td>
      </tr>` : ''}
      ${totals.advanceApplied > 0 ? `
      <tr class="advance-row">
        <td colspan="4" class="r">Less: Advance Balance Applied</td>
        <td class="r">- ₹${printValue(totals.advanceApplied.toFixed(2))}</td>
      </tr>` : ''}
      ${totals.showBreakdown ? `
      <tr class="net-row">
        <td colspan="4" class="r">NET PAYABLE</td>
        <td class="r">₹${printValue(totals.netPayable.toFixed(2))}</td>
      </tr>` : ''}
    `;

    const css = `
      @page { size: A4 portrait; margin: 14mm 12mm; }
      * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      body { margin:0; padding:0; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:10pt; color:#1a1a1a; background:#fff; }
      .page { width:100%; max-width:190mm; margin:0 auto; position:relative; background:#fff; }
      ${logoUrl ? `
      /* watermark */
      .page::before {
        content:''; position:fixed; bottom:25mm; left:10mm; width:85mm; height:52mm;
        background:url('${logoUrl}') center/contain no-repeat; opacity:0.05; pointer-events:none; z-index:0;
      }` : ''}
      .page > * { position:relative; z-index:1; }
      /* header */
      .accent-bar { height:4px; background:${accentColor}; margin-bottom:16px; }
      .header { display:flex; align-items:center; justify-content:center; gap:10px; padding-bottom:14px; margin-bottom:16px; border-bottom:3px double #CBD5E1; }
      /* Fixed, identical size for both slots — whether one, both, or neither is set, the company
         name in the middle stays centered instead of drifting toward whichever side is empty. */
      .header-image-slot { flex:0 0 30mm; width:30mm; height:22.5mm; display:flex; align-items:center; justify-content:center; }
      .header-image-slot img { max-width:100%; max-height:100%; object-fit:contain; }
      .header-text { flex:1; text-align:center; min-width:0; }
      .company-name { font-size:24pt; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:${primaryColor}; }
      .tagline { font-size:9.5pt; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#8a8a8a; margin-top:4px; }
      .contact-line { font-size:9pt; color:#555; margin-top:6px; font-weight:500; }
      .address-line { font-size:8.5pt; color:#777; margin-top:2px; }
      /* bill-to / invoice-details */
      .info-grid { display:flex; gap:24px; margin-bottom:20px; }
      .info-col { flex:1; }
      .info-col table { width:100%; border-collapse:collapse; }
      .info-col td { font-size:9.5pt; padding:2px 0; vertical-align:top; color:#333; }
      .info-col td.label { color:#666; font-weight:600; width:78px; white-space:nowrap; padding-right:8px; }
      .info-col td.strong { font-weight:700; color:${primaryColor}; }
      /* trip table */
      .tt { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:9pt; }
      .tt th { background:${primaryColor}; color:#fff; padding:7px 8px; border:1px solid #E2E8F0; font-weight:700; text-align:center; }
      .tt th.l { text-align:left; }
      .tt th.r, .tt td.r { text-align:right; }
      .tt td { padding:6px 8px; border:1px solid #E2E8F0; color:#1a1a1a; }
      .tt tbody tr:nth-child(even) { background:#F8FAFC; }
      .subtotal-row td { font-weight:700; color:${primaryColor}; }
      .discount-row td { background:#FDEDED; color:#A61B1B; font-weight:700; }
      .gst-row td { background:#EAF2FE; color:#0B4EA6; font-weight:700; }
      .grand-total-row td { background:#F1F1F1; color:#1a1a1a; font-weight:800; }
      .advance-row td { background:#FFF9E6; color:#7A5A00; font-weight:700; }
      .net-row td { background:#EBF5EC; color:#0B5E1F; font-weight:900; font-size:10pt; }
      /* amount in words (+ optional UPI QR to its right) */
      .words-row { display:flex; gap:14px; align-items:flex-start; margin-bottom:16px; }
      .words-col { flex:1; min-width:0; }
      .words-box { margin-bottom:8px; padding:8px 10px; background:#fcfcfc; border:1px dashed #ddd; border-radius:4px; font-size:9pt; color:#555; }
      .words-box:last-child { margin-bottom:0; }
      .words-box b { color:#1a1a1a; }
      .upi-qr-box { flex:0 0 90px; width:90px; height:90px; display:flex; align-items:center; justify-content:center; }
      .upi-qr-box img { max-width:100%; max-height:100%; object-fit:contain; }
      /* bank + signature footer — never split across a page break (a printer/PDF-via-print
         engine, unlike html2canvas, actually respects this). */
      .footer-row { display:flex; gap:24px; border-top:2px double #CBD5E1; padding-top:14px; font-size:9pt; color:#444; page-break-inside:avoid; break-inside:avoid; }
      .bank-col { flex:1; }
      .bank-title { font-weight:700; color:${primaryColor}; margin-bottom:4px; font-size:9.5pt; }
      .bank-col table { width:100%; font-size:8.5pt; }
      .bank-col td.label { color:#666; font-weight:600; width:95px; }
      .bank-col td.strong { font-weight:700; color:#111; }
      .sign-col { flex:0 0 160px; text-align:right; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; }
      .for-company { font-weight:600; color:#333; font-style:italic; margin-bottom:8px; }
      .sign-img { max-width:140px; max-height:50px; object-fit:contain; margin-bottom:4px; }
      .sign-line { font-weight:700; border-top:1px solid #666; padding-top:4px; width:140px; margin-left:auto; text-align:center; font-size:8.5pt; }
      /* footer note */
      .footer-note { text-align:center; margin-top:18px; font-size:8.5pt; color:#888; font-style:italic; page-break-inside:avoid; break-inside:avoid; }
      @media print {
        body { background:#fff; }
        .page { max-width:100%; }
        .page::before { position:fixed; }
      }
    `;

    const docTitle = opts.docTitle || (isGstBill ? 'Tax Invoice' : 'Invoice');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>${printValue(docTitle)} - ${printValue(customer.name)}</title>
  <style>${css}</style>
</head>
<body>
<div class="page">
  <div class="accent-bar"></div>
  <div class="header">
    <div class="header-image-slot">${headerLeftUrl ? `<img src="${headerLeftUrl}" alt="" />` : ''}</div>
    <div class="header-text">
      <div class="company-name">${printValue(companyName)}</div>
      <div class="tagline">${printValue(tagline)}</div>
      ${contactLine ? `<div class="contact-line">${contactLine}</div>` : ''}
      ${addressLine ? `<div class="address-line">${printValue(addressLine)}</div>` : ''}
    </div>
    <div class="header-image-slot">${headerRightUrl ? `<img src="${headerRightUrl}" alt="" />` : ''}</div>
  </div>

  <div class="info-grid">
    <div class="info-col">
      <table>
        <tr><td class="label">M/s.:</td><td class="strong">${printValue(customer.name)}</td></tr>
        <tr><td class="label">Address:</td><td>${printValue(customer.address || 'N/A')}</td></tr>
        <tr><td class="label">Phone:</td><td>${printValue(customer.phone || 'N/A')}</td></tr>
        <tr><td class="label">GST No.:</td><td>${printValue(customerGst || '—')}</td></tr>
      </table>
    </div>
    <div class="info-col">
      <table>
        <tr><td class="label">Bill No.:</td><td class="strong">${printValue(opts.billNoLabel || '01')}</td></tr>
        <tr><td class="label">Date:</td><td>${printValue(opts.billDateLabel)}</td></tr>
        <tr><td class="label">Total Trips:</td><td>${tripsForBill.length}</td></tr>
      </table>
    </div>
  </div>

  <table class="tt">
    <thead>
      <tr>
        <th style="width:15%;">Date</th>
        <th class="l" style="width:25%;">Pickup</th>
        <th class="l" style="width:25%;">Drop</th>
        <th class="r" style="width:17.5%;">Paid</th>
        <th class="r" style="width:17.5%;">Amount</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr class="subtotal-row">
        <td colspan="3" class="r">Sub Total</td>
        <td class="r">₹${printValue(totals.received.toFixed(2))}</td>
        <td class="r">₹${printValue(totals.subTotal.toFixed(2))}</td>
      </tr>
      ${breakdownRowsHtml}
    </tfoot>
  </table>

  <div class="words-row">
    <div class="words-col">
      <div class="words-box"><b>Amount in Words:</b> ${printValue(amountWords)}</div>
      ${totals.advanceApplied > 0 ? `<div class="words-box"><b>Advance Balance Remaining:</b> ₹${printValue((totals.advanceAvailable - totals.advanceApplied).toFixed(2))}</div>` : ''}
    </div>
    ${showUpiQr ? `<div class="upi-qr-box"><img src="${upiQrUrl}" alt="UPI QR" /></div>` : ''}
  </div>

  <div class="footer-row">
    <div class="bank-col">
      <div class="bank-title">BANK DETAILS</div>
      <table>
        <tr><td class="label">Bank Name:</td><td>${printValue(bankNameToPrint || '—')}</td></tr>
        <tr><td class="label">Branch:</td><td>${printValue(branchToPrint || '—')}</td></tr>
        <tr><td class="label">Account No:</td><td class="strong">${printValue(accountToPrint || '—')}</td></tr>
        <tr><td class="label">IFSC Code:</td><td class="strong">${printValue(ifscToPrint || '—')}</td></tr>
      </table>
    </div>
    <div class="sign-col">
      <div class="for-company">For ${printValue(companyName)}</div>
      ${signatureUrl ? `<img src="${signatureUrl}" alt="Signature" class="sign-img" />` : '<div style="height:38px;"></div>'}
      <div class="sign-line">Authorized Signatory</div>
    </div>
  </div>

  <div class="footer-note">${printValue(footerNote)}</div>
</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},450);});</script>
</body>
</html>`;

    return html;
  };

  // Opens the print window (browser) or hands the HTML to the native printer plugin (Capacitor).
  // Used for both the main filtered bill and the single-trip "Download Bill" action.
  // Uses the global toast (not the inline `dialogMessage` Alert) because this is called from two
  // places — the Invoice Preview dialog AND the Trip History list's per-trip "Download Bill"
  // button, which renders nowhere near that Alert. A toast is visible either way.
  const openPrintWindow = (html: string, docName: string) => {
    if (Capacitor.isNativePlatform()) {
      const cleanHtml = html.replace('<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},450);});</script>', '');
      Printer.printHtml({
        name: docName,
        html: cleanHtml
      }).catch(err => {
        console.error("Print error:", err);
        toast.error('Could not open the print dialog. Please try again.');
      });
    } else {
      // Returns null instead of throwing when a popup blocker steps in — silently doing nothing
      // here is exactly what makes a blocked popup look like "the button doesn't work" instead
      // of a browser setting the user can actually fix.
      const printWindow = window.open('', '', 'width=960,height=900');
      if (!printWindow) {
        toast.error('Your browser blocked the print window. Please allow pop-ups for this site and try again.');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
    }
  };

  const promptSaveBill = (action: 'print' | 'whatsapp' | 'email') => {
    setSaveBillPromptBillNo(billNo);
    setSaveBillPrompt({ action });
  };

  const handleSaveBillPromptProceed = async (shouldSave: boolean) => {
    const action = saveBillPrompt?.action;
    if (!action) return;

    if (saveBillPromptBillNo.trim()) setBillNo(saveBillPromptBillNo.trim());

    setSaveBillPrompt(null);

    if (shouldSave) {
      setSavingBillRecord(true);
      setDialogMessage(null);
      try {
        const totals = getBillTotals(billTrips);
        const finalNetPayable = totals.showBreakdown ? totals.netPayable : totals.subTotal;
        const useBillNo = saveBillPromptBillNo.trim() || billNo || '01';
        await saveBill({
          customerId: customer!.id,
          billNo: useBillNo,
          billDate: billDate ? new Date(billDate).toISOString() : new Date().toISOString(),
          isGstBill,
          gstPercent: totals.gstPct,
          discount: totals.discount,
          subTotal: totals.subTotal,
          received: totals.received,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          advanceApplied: totals.advanceApplied,
          netPayable: finalNetPayable,
          amountInWords: amountInWords.trim() || `${convertNumberToWords(Math.round(finalNetPayable))} Rupees Only`,
          trips: billTrips.map(t => ({
            tripId: t.id,
            date: t.date,
            pickupLocation: t.pickupLocation,
            dropLocation: t.dropLocation,
            amount: t.amount,
            paidAmount: t.paidAmount || 0,
          })),
          customerPhone: customer!.phone || '',
          customerAddress: customer!.address || '',
          customerGst: customerGst.trim(),
          bankName: bankName.trim(),
          bankBranch: branch.trim(),
          accountNumber: accountNumber.trim(),
          ifscCode: ifscCode.trim(),
        });
        toast.success('Bill saved to My Bills.');
      } catch (error) {
        setDialogMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save the bill' });
      } finally {
        setSavingBillRecord(false);
      }
    }

    if (action === 'print') await executePrintBill();
    else if (action === 'whatsapp') await handleWhatsAppBill();
    else if (action === 'email') await handleEmailBill();
  };

  const executePrintBill = async () => {
    setDialogMessage(null);
    setPrintingBill(true);
    try {
      if (customer) await checkBillGenerationLimit(customer.id, 'pdf');
    } catch (error) {
      setDialogMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not generate the bill' });
      setPrintingBill(false);
      return;
    }
    const formattedBillDate = billDate
      ? new Date(billDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const totals = getBillTotals(billTrips);
    const html = buildBillHtml(billTrips, {
      billNoLabel: saveBillPromptBillNo.trim() || billNo || '01',
      billDateLabel: formattedBillDate,
      totals,
      amountWordsOverride: amountInWords,
    });
    openPrintWindow(html, `Invoice_${customer.name}`);
    setPrintingBill(false);
  };

  const handlePrintBill = async () => {
    promptSaveBill('print');
  };

  // Trip History → "Download Bill": a standalone single-trip invoice, independent of whatever
  // date filter / GST / discount is currently set up for the main bill above.
  const generateTripBillDownload = (trip: Trip, applyAdvance: boolean) => {
    const formattedDate = new Date(trip.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const totals = getBillTotals([trip], { discount: 0, gstEnabled: false, applyAdvance });
    const html = buildBillHtml([trip], {
      billNoLabel: `TRIP-${trip.id.slice(-6).toUpperCase()}`,
      billDateLabel: formattedDate,
      totals,
      docTitle: 'Trip Bill',
    });
    openPrintWindow(html, `Trip_${trip.id}`);
  };

  // Asks first whether the customer's advance balance should be applied, since a single-trip
  // bill often serves a different purpose than the main aggregated one.
  const handleDownloadTripBill = (trip: Trip) => {
    if ((customer?.advanceBalance || 0) > 0) {
      setTripBillAdvancePrompt(trip);
    } else {
      generateTripBillDownload(trip, false);
    }
  };

  // "Save to My Bills" — snapshots this preview (trip lines + totals as they are right now)
  // into a permanent record, independent of the live preview which recomputes on every open.
  const handleSaveToMyBills = async () => {
    if (!customer) return;
    setSavingBillRecord(true);
    setDialogMessage(null);
    try {
      const totals = getBillTotals(billTrips);
      const finalNetPayable = totals.showBreakdown ? totals.netPayable : totals.subTotal;
      await saveBill({
        customerId: customer.id,
        billNo: billNo || '01',
        billDate: billDate ? new Date(billDate).toISOString() : new Date().toISOString(),
        isGstBill,
        gstPercent: totals.gstPct,
        discount: totals.discount,
        subTotal: totals.subTotal,
        received: totals.received,
        gstAmount: totals.gstAmount,
        grandTotal: totals.grandTotal,
        advanceApplied: totals.advanceApplied,
        netPayable: finalNetPayable,
        amountInWords: amountInWords.trim() || `${convertNumberToWords(Math.round(finalNetPayable))} Rupees Only`,
        trips: billTrips.map(t => ({
          tripId: t.id,
          date: t.date,
          pickupLocation: t.pickupLocation,
          dropLocation: t.dropLocation,
          amount: t.amount,
          paidAmount: t.paidAmount || 0,
        })),
        customerPhone: customer.phone || '',
        customerAddress: customer.address || '',
        customerGst: customerGst.trim(),
        bankName: bankName.trim(),
        bankBranch: branch.trim(),
        accountNumber: accountNumber.trim(),
        ifscCode: ifscCode.trim(),
      });
      setDialogMessage({ type: 'success', text: 'Bill saved to My Bills.' });
    } catch (error) {
      setDialogMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save the bill' });
    } finally {
      setSavingBillRecord(false);
    }
  };

  // Handle download/share bill on mobile (Android/iOS)
  const handleShareBill = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `Invoice - ${customer?.name}`,
          text: buildBillText(),
          dialogTitle: 'Share Invoice',
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      await handlePrintBill();
    }
  };

  // Single source of truth for the bill totals shown across the collapsed Billing Preview,
  // the Invoice Preview dialog, and (via buildBillHtml) the printed/PDF version.
  const billTotals = getBillTotals(billTrips);

  // Advance history, newest first — deleted entries are kept as a read-only record (soft delete)
  // and shown separately so they no longer count toward the balance but aren't lost either.
  const sortedAdvanceHistory = [...(customer.advanceHistory || [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Advance Balance dialog filters — search matches note, amount, or date; amount range and
  // date range (a single specific day works fine as From === To) are both optional.
  const matchesAdvanceFilters = (entry: (typeof sortedAdvanceHistory)[number]) => {
    const term = advanceSearchTerm.trim().toLowerCase();
    if (term) {
      const dateStr = new Date(entry.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }).toLowerCase();
      const matchesSearch =
        (entry.note || '').toLowerCase().includes(term) ||
        String(entry.amount).includes(term) ||
        dateStr.includes(term);
      if (!matchesSearch) return false;
    }
    if (advanceAmountMin && entry.amount < Number(advanceAmountMin)) return false;
    if (advanceAmountMax && entry.amount > Number(advanceAmountMax)) return false;
    if (advanceDateFrom && new Date(entry.date).getTime() < new Date(advanceDateFrom).getTime()) return false;
    if (advanceDateTo && new Date(entry.date).getTime() > new Date(advanceDateTo).getTime() + 86399999) return false;
    return true;
  };
  const isAdvanceFiltered = Boolean(advanceSearchTerm || advanceAmountMin || advanceAmountMax || advanceDateFrom || advanceDateTo);
  const activeAdvanceHistory = sortedAdvanceHistory.filter(e => !e.deleted).filter(matchesAdvanceFilters);
  const deletedAdvanceHistory = sortedAdvanceHistory.filter(e => e.deleted).filter(matchesAdvanceFilters);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
          <IconButton
            onClick={handleBackToHome}
            sx={{ mr: 1.5, bgcolor: 'action.hover', flexShrink: 0 }}
            aria-label="back"
          >
            <ArrowBack />
          </IconButton>
          <Typography
            variant="h4"
            component="h1"
            color="primary.dark"
            noWrap
            sx={{ fontWeight: 800, fontSize: { xs: '1.4rem', sm: '2.125rem' }, minWidth: 0 }}
          >
            Customer Details
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, ml: { xs: 0, sm: 'auto' }, width: { xs: '100%', sm: 'auto' } }}>
          <Button
            variant="outlined"
            onClick={() => setIsAdvanceHistoryOpen(true)}
            sx={{ flex: { xs: 1, sm: '0 0 auto' }, fontWeight: 750 }}
            startIcon={<Savings />}
          >
            Advance Balance
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate(`/add-trip?customerId=${id}`)}
            sx={{ flex: { xs: 1, sm: '0 0 auto' }, fontWeight: 750 }}
            startIcon={<Add />}
          >
            Add Trip
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={openBillTypeDialog}
            sx={{
              flex: { xs: 1, sm: '0 0 auto' },
              fontWeight: 750, color: '#000', '&:hover': { bgcolor: 'primary.dark' },
            }}
            startIcon={<Receipt />}
          >
            View & Print Bill
          </Button>
        </Box>
      </Box>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 4,
          borderRadius: 2,
          background: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box sx={{ mr: 4, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="h5"
                gutterBottom
                sx={{
                  fontWeight: 700,
                  color: 'text.primary',
                  mb: 0,
                }}
              >
                {customer.name}
              </Typography>
              <Tooltip title="Edit name / phone / address">
                <IconButton size="small" onClick={openEditCustomer} sx={{ color: 'text.secondary', '&:hover': { color: '#F0B90B' } }}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <Phone sx={{ fontSize: 20, mr: 1, color: '#F0B90B' }} />
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                {customer.phone || 'No phone number'}
              </Typography>
            </Box>
            {customer.address && (
              <Box sx={{ display: 'flex', alignItems: 'flex-start', mt: 1 }}>
                <LocationOn sx={{ fontSize: 20, mr: 1, mt: 0.5, color: '#0ECB81' }} />
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                  {customer.address}
                </Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, ml: 'auto' }}>
            <Chip
              icon={<LocalShipping />}
              label={`${totalTrips} Trips`}
              sx={{ fontWeight: 600, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', border: '1px solid rgba(240, 185, 11, 0.2)' }}
            />
            <Chip
              icon={<AccountBalanceWallet />}
              label={`₹${totalAmount.toFixed(2)} Total`}
              sx={{ fontWeight: 600, backgroundColor: 'rgba(14, 203, 129, 0.1)', color: '#0ECB81', border: '1px solid rgba(14, 203, 129, 0.2)' }}
            />
            {pendingAmount > 0 && (
              <Chip
                icon={<AccountBalanceWallet />}
                label={`₹${pendingAmount.toFixed(2)} Pending`}
                sx={{ fontWeight: 600, backgroundColor: 'rgba(246, 70, 93, 0.1)', color: '#F6465D', border: '1px solid rgba(246, 70, 93, 0.2)' }}
              />
            )}
          </Box>
        </Box>

        {/* Advance balance — money the customer has already paid ahead of any specific trip */}
        <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Savings sx={{ color: '#F0B90B', fontSize: 20 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Advance Balance:
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: (customer.advanceBalance || 0) > 0 ? '#0ECB81' : 'text.primary' }}>
            ₹{(customer.advanceBalance || 0).toFixed(2)}
          </Typography>
          <Button
            size="small"
            startIcon={<Add />}
            onClick={openAddAdvanceDialog}
            sx={{ ml: { xs: 0, sm: 'auto' }, color: '#F0B90B', fontWeight: 700 }}
          >
            Add Advance Payment
          </Button>
        </Box>
      </Paper>

{/* Printable Bill Section — collapsed by default so the page isn't a wall of scrolling;
    expand it when you're actually ready to prep a bill for this customer. */}
<Accordion
  disableGutters
  sx={{ mb: 4, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`, borderRadius: 2, '&:before': { display: 'none' } }}
>
  <AccordionSummary expandIcon={<ExpandMore sx={{ color: 'text.secondary' }} />}>
    <Typography sx={{ display: 'flex', alignItems: 'center', color: 'text.primary', fontWeight: 700 }}>
      <Receipt sx={{ mr: 1, color: '#F0B90B' }} />
      Billing Details
    </Typography>
  </AccordionSummary>
  <AccordionDetails>
<Box ref={billRef} sx={{ marginBottom: 0 }}>
  <Paper
    elevation={0}
    sx={{
      p: 3,
      mb: 3,
      bgcolor: 'action.hover',
      borderRadius: 2,
      border: '1px solid',
      borderColor: 'divider',
    }}
  >
    <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', mb: 2, color: 'text.primary', fontWeight: 600 }}>
      <Receipt sx={{ mr: 1, color: '#F0B90B' }} />
      Bill Inputs
    </Typography>
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Bill Number"
          value={billNo}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBillNo(e.target.value)}
          placeholder="Enter bill number"
          variant="outlined"
          size="small"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Bill Date"
          type="date"
          value={billDate}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBillDate(e.target.value)}
          variant="outlined"
          size="small"
          InputLabelProps={{ shrink: true }}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Customer GST Number"
          value={customerGst}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomerGst(e.target.value)}
          placeholder="Enter customer GSTIN"
          variant="outlined"
          size="small"
          InputProps={{
            startAdornment: <InputAdornment position="start">GSTIN</InputAdornment>,
          }}
        />
      </Grid>
      <Grid item xs={12}>
        {branding?.bankAccounts && branding.bankAccounts.length > 0 ? (
          <>
            <FormControl fullWidth size="small">
              <InputLabel id="bank-account-label">Bank Account (for this bill)</InputLabel>
              <Select
                labelId="bank-account-label"
                label="Bank Account (for this bill)"
                value={selectedBankAccountId}
                onChange={(e: SelectChangeEvent) => handleSelectBankAccount(e.target.value)}
              >
                {branding.bankAccounts.map(account => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.label || account.bankName || 'Unnamed account'}
                    {account.accountNumber ? ` — ${account.accountNumber}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {(bankName || branch || accountNumber || ifscCode) && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                {[bankName, branch, accountNumber, ifscCode].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </>
        ) : (
          <Alert severity="info" sx={{ alignItems: 'center' }}>
            No bank accounts saved yet. Add one under{' '}
            <Box
              component="span"
              onClick={() => navigate('/settings')}
              sx={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 700 }}
            >
              Bill Branding &amp; Settings
            </Box>{' '}
            to have it show up here.
          </Alert>
        )}
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Amount in Words"
          value={amountInWords}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAmountInWords(e.target.value)}
          placeholder="Enter amount in words"
          variant="outlined"
          size="small"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="Discount (optional)"
          type="number"
          value={discountAmount}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDiscountAmount(e.target.value)}
          placeholder="0.00"
          variant="outlined"
          size="small"
          InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
        />
      </Grid>
      {isGstBill && (
        <Grid item xs={12}>
          <Alert severity="info">
            GST bill — {gstPercent || 0}% GST will be applied to the sub total{discountAmount ? ' (after the discount above)' : ''}.
          </Alert>
        </Grid>
      )}
    </Grid>
  </Paper>

  <Paper
    elevation={0}
    sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
  >
    <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>Billing Preview</Typography>
        {billPaymentFilter !== 'all' && (
          <Chip
            size="small"
            label={billPaymentFilter === 'paid' ? 'Paid trips only' : 'Unpaid trips only'}
            sx={{ fontWeight: 700, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B' }}
          />
        )}
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        The printed bill will use these columns: Date, From, To, Advance, Amount, Status.
      </Typography>
    </Box>

    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: 'text.primary' }}>Customer</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}><strong>Name:</strong> <span style={{ color: theme.palette.text.primary }}>{customer.name}</span></Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}><strong>Phone:</strong> <span style={{ color: theme.palette.text.primary }}>{customer.phone || 'N/A'}</span></Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}><strong>Address:</strong> <span style={{ color: theme.palette.text.primary }}>{customer.address || 'N/A'}</span></Typography>
    </Box>

    <Box component="div" sx={{ width: '100%', mt: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', minWidth: '500px', borderCollapse: 'collapse', fontSize: '0.93rem', color: theme.palette.text.primary }}>
        <thead>
          <tr>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'left', width: '15%' }}>Date</th>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'left', width: '22%' }}>From</th>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'left', width: '23%' }}>To</th>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'right', width: '14%' }}>Paid</th>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'right', width: '14%' }}>Amount</th>
            <th style={{ padding: '10px', borderBottom: `2px solid ${theme.palette.divider}`, textAlign: 'center', width: '12%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {billTrips.map((trip, idx) => (
            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? theme.palette.action.hover : theme.palette.background.paper }}>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}` }}>{new Date(trip.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })}</td>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}` }}>{trip.pickupLocation}</td>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}` }}>{trip.dropLocation}</td>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}`, textAlign: 'right' }}>₹{(trip.paidAmount || 0).toFixed(2)}</td>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}`, textAlign: 'right' }}>₹{trip.amount.toFixed(2)}</td>
              <td style={{ padding: '10px', borderBottom: `1px solid ${theme.palette.divider}`, textAlign: 'center', color: trip.isPaid ? '#0ECB81' : '#F6465D' }}>{trip.isPaid ? 'Paid' : 'Pending'}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', borderTop: `2px solid ${theme.palette.divider}`, color: '#F0B90B' }}>Sub Total</td>
            <td style={{ padding: '10px', fontWeight: 700, textAlign: 'right', borderTop: `2px solid ${theme.palette.divider}`, color: '#F0B90B' }}>₹{billTotals.received.toFixed(2)}</td>
            <td style={{ padding: '10px', fontWeight: 700, textAlign: 'right', borderTop: `2px solid ${theme.palette.divider}`, color: '#F0B90B' }}>₹{billTotals.subTotal.toFixed(2)}</td>
            <td style={{ padding: '10px', borderTop: `2px solid ${theme.palette.divider}` }} />
          </tr>
          {billTotals.discount > 0 && (
            <tr style={{ backgroundColor: alpha('#F6465D', theme.palette.mode === 'dark' ? 0.14 : 0.08) }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', color: '#F6465D' }}>Discount</td>
              <td style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: '#F6465D' }}>- ₹{billTotals.discount.toFixed(2)}</td>
              <td />
            </tr>
          )}
          {billTotals.gstEnabled && (
            <tr style={{ backgroundColor: alpha('#58A6FF', theme.palette.mode === 'dark' ? 0.14 : 0.08) }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', color: '#58A6FF' }}>GST ({billTotals.gstPct}%)</td>
              <td style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: '#58A6FF' }}>+ ₹{billTotals.gstAmount.toFixed(2)}</td>
              <td />
            </tr>
          )}
          {(billTotals.discount > 0 || billTotals.gstEnabled) && (
            <tr style={{ backgroundColor: theme.palette.action.hover }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: theme.palette.text.primary }}>Grand Total</td>
              <td style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: theme.palette.text.primary }}>₹{billTotals.grandTotal.toFixed(2)}</td>
              <td />
            </tr>
          )}
          {billTotals.received > 0 && (
            <tr style={{ backgroundColor: alpha('#F0B90B', theme.palette.mode === 'dark' ? 0.14 : 0.08) }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', color: theme.palette.mode === 'dark' ? '#C8A200' : '#7A5A00' }}>Less: Amount Received</td>
              <td style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: theme.palette.mode === 'dark' ? '#C8A200' : '#7A5A00' }}>- ₹{billTotals.received.toFixed(2)}</td>
              <td />
            </tr>
          )}
          {billTotals.advanceApplied > 0 && (
            <tr style={{ backgroundColor: alpha('#F0B90B', theme.palette.mode === 'dark' ? 0.14 : 0.08) }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', color: theme.palette.mode === 'dark' ? '#C8A200' : '#7A5A00' }}>Less: Advance Balance Applied</td>
              <td style={{ padding: '10px', fontWeight: 800, textAlign: 'right', color: theme.palette.mode === 'dark' ? '#C8A200' : '#7A5A00' }}>- ₹{billTotals.advanceApplied.toFixed(2)}</td>
              <td />
            </tr>
          )}
          {billTotals.showBreakdown && (
            <tr style={{ backgroundColor: alpha('#0ECB81', theme.palette.mode === 'dark' ? 0.14 : 0.08) }}>
              <td colSpan={4} style={{ padding: '10px', fontWeight: 900, textAlign: 'right', color: '#0ECB81', fontSize: '1rem' }}>NET PAYABLE</td>
              <td style={{ padding: '10px', fontWeight: 900, textAlign: 'right', color: '#0ECB81', fontSize: '1rem' }}>₹{billTotals.netPayable.toFixed(2)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </Box>
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>Amount in words: <span style={{ color: theme.palette.text.secondary }}>{amountInWords.trim() || `${convertNumberToWords(Math.round(billTotals.showBreakdown ? billTotals.netPayable : billTotals.subTotal))} Rupees Only`}</span></Typography>
        {billTotals.advanceApplied > 0 && (
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            Advance balance remaining after this bill: <span style={{ color: '#0ECB81', fontWeight: 700 }}>₹{(billTotals.advanceAvailable - billTotals.advanceApplied).toFixed(2)}</span>
          </Typography>
        )}
      </Box>
      {shouldShowUpiQr(branding, isGstBill) && (
        <Box sx={{ flex: '0 0 90px', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fff', borderRadius: 1 }}>
          <Box component="img" src={branding?.upiQrImageDataUrl} alt="UPI QR" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </Box>
      )}
    </Box>
  </Paper>
</Box>
  </AccordionDetails>
</Accordion>

      {/* Trip date filter — narrows the stats below, the Billing Preview / bill, and Trip History */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          borderRadius: 2,
          background: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#F0B90B', fontWeight: 700, mr: 1 }}>
          <FilterAlt fontSize="small" />
          <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>Filter by trip date</Typography>
        </Box>
        <TextField
          label="From"
          type="date"
          size="small"
          value={tripFilterFrom}
          onChange={e => setTripFilterFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160 }}
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={tripFilterTo}
          onChange={e => setTripFilterTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160 }}
        />
        {isDateFiltered && (
          <>
            <Chip
              label={`${customerTrips.length} of ${allCustomerTrips.length} trips shown`}
              sx={{ fontWeight: 700, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B' }}
            />
            <Button
              size="small"
              startIcon={<Clear />}
              onClick={() => { setTripFilterFrom(''); setTripFilterTo(''); }}
              sx={{ color: 'text.secondary' }}
            >
              Clear
            </Button>
          </>
        )}
        <Typography variant="body2" sx={{ color: 'text.secondary', width: '100%' }}>
          This also controls which trips are included when you view or print the bill below.
        </Typography>
      </Paper>

      {/* Summary Cards */}
      <Grid container spacing={{ xs: 1.5, sm: 3 }} sx={{ mb: 4 }}>
        <Grid item xs={4}>
          <Card sx={{
            height: '100%',
            borderRadius: 2,
            background: theme.palette.background.paper,
            borderTop: `3px solid ${theme.palette.divider}`,
            color: 'text.primary',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.3s, box-shadow 0.3s',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(255, 255, 255, 0.05)' },
          }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>
                Total Trips
              </Typography>
              <Typography sx={{ color: 'text.primary', fontWeight: 800, fontSize: { xs: '1.3rem', sm: '2.2rem' } }}>{totalTrips}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={4}>
          <Card sx={{
            height: '100%',
            borderRadius: 2,
            background: theme.palette.background.paper,
            borderTop: '3px solid #0ECB81',
            color: 'text.primary',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.3s, box-shadow 0.3s',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(14, 203, 129, 0.15)' },
          }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>Total Revenue</Typography>
              <Typography sx={{ color: 'text.primary', fontWeight: 800, fontSize: { xs: '0.95rem', sm: '2.2rem' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>₹{totalAmount.toFixed(2)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={4}>
          <Card sx={{
            height: '100%',
            borderRadius: 2,
            background: theme.palette.background.paper,
            borderTop: '3px solid #F6465D',
            color: 'text.primary',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.3s, box-shadow 0.3s',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(246, 70, 93, 0.15)' },
          }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>Pending Amount</Typography>
              <Typography sx={{ color: '#F6465D', fontWeight: 800, fontSize: { xs: '0.95rem', sm: '2.2rem' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>₹{pendingAmount.toFixed(2)}</Typography>
              <Typography variant="body2" sx={{ color: '#0ECB81', mt: 1, fontWeight: 500, fontSize: { xs: '0.65rem', sm: '0.875rem' }, display: { xs: 'none', sm: 'block' } }}>
                {Math.round((paidAmount / (totalAmount || 1)) * 100)}% collected
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Trip List */}
      <TripList
        customerAdvanceBalance={customer.advanceBalance || 0}
        trips={customerTrips}
        customerName={customer.name}
        onUpdatePaymentStatus={handlePaymentStatusUpdate}
        onDownloadTripBill={handleDownloadTripBill}
      />

      {/* Bill Type Dialog — GST vs Non-GST, asked whenever "View & Print Bill" is clicked */}
      <Dialog open={isBillTypeDialogOpen} onClose={() => setIsBillTypeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate Bill</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
            {billTypeError && <Alert severity="error">{billTypeError}</Alert>}
            <FormControl fullWidth size="small">
              <InputLabel id="bill-type-label">Bill Type</InputLabel>
              <Select
                labelId="bill-type-label"
                label="Bill Type"
                value={billTypeChoice}
                onChange={(e: SelectChangeEvent) => setBillTypeChoice(e.target.value as 'non-gst' | 'gst')}
              >
                <MenuItem value="non-gst">Non-GST Bill</MenuItem>
                <MenuItem value="gst">GST Bill</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="From"
                type="date"
                size="small"
                value={tripFilterFrom}
                onChange={e => setTripFilterFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="To"
                type="date"
                size="small"
                value={tripFilterTo}
                onChange={e => setTripFilterTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Box>

            <FormControl fullWidth size="small">
              <InputLabel id="bill-payment-filter-label">Include</InputLabel>
              <Select
                labelId="bill-payment-filter-label"
                label="Include"
                value={billPaymentFilter}
                onChange={(e: SelectChangeEvent) => setBillPaymentFilter(e.target.value as 'all' | 'paid' | 'unpaid')}
              >
                <MenuItem value="all">All trips (paid &amp; unpaid)</MenuItem>
                <MenuItem value="paid">Paid trips only</MenuItem>
                <MenuItem value="unpaid">Unpaid trips only</MenuItem>
              </Select>
            </FormControl>

            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {billTrips.length} of {customerTrips.length} trip{customerTrips.length === 1 ? '' : 's'} in range will be included in this bill.
            </Typography>

            {billTypeChoice === 'gst' && (
              <>
                <TextField
                  label="GST Percentage"
                  type="number"
                  value={gstPercent}
                  onChange={e => setGstPercent(e.target.value)}
                  fullWidth
                  autoFocus
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  placeholder="e.g. 18"
                />
                <TextField
                  label="Bill Number"
                  value={gstBillNoInput}
                  onChange={e => setGstBillNoInput(e.target.value)}
                  fullWidth
                  placeholder="Enter GST invoice number"
                />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  GST is applied to the sub total (after any discount), and the customer's paid amount
                  and advance balance are subtracted from the final GST-inclusive total.
                </Typography>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsBillTypeDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleBillTypeContinue} variant="contained" sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Invoice Preview Dialog */}
      <Dialog
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        maxWidth="md"
        fullWidth
        fullScreen={Capacitor.isNativePlatform() || isSmallScreen}
        PaperProps={{
          sx: {
            bgcolor: '#ffffff',
            color: '#1a1a1a',
            p: { xs: 0, sm: 3 },
            backgroundImage: 'none', // Remove default Dialog dark theme gradient overlay
            position: 'relative',
            overflow: 'hidden',
          }
        }}
      >
        <LoadingOverlay
          open={savingBillRecord || sharingBill || printingBill}
          absolute
          label={savingBillRecord ? 'Saving bill…' : sharingBill ? 'Preparing PDF…' : 'Generating bill…'}
        />
        <DialogTitle sx={{ m: 0, p: 2, pt: 'calc(16px + env(safe-area-inset-top))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f5f5f5', color: '#333', borderBottom: '1px solid #ddd' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#1a1a1a' }}>Invoice Bill Preview</Typography>
          <IconButton
            aria-label="close"
            onClick={() => setIsPreviewOpen(false)}
            sx={{ color: '#666' }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: { xs: 1, sm: 3 }, bgcolor: '#fafafa' }}>
          {dialogMessage && (
            <Alert severity={dialogMessage.type} sx={{ mb: 2 }} onClose={() => setDialogMessage(null)}>
              {dialogMessage.text}
            </Alert>
          )}
          {/* Shrinks the sheet below to fit entirely on screen (width AND height) on the
              fullscreen mobile/native preview, instead of requiring a scroll to see it all —
              see useFitPreviewToViewport. A no-op on desktop. */}
          <Box ref={previewViewportRef} sx={{ height: '100%' }}>
          <Box ref={previewSizerRef} sx={{ width: 'fit-content', maxWidth: '100%', margin: '0 auto', overflow: 'hidden' }}>
          {/* Printable Sheet Simulation container */}
          <Box
            ref={previewRef}
            sx={{
              maxWidth: '194mm',
              margin: '0 auto',
              p: { xs: 2, sm: 4 },
              bgcolor: '#ffffff',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              borderRadius: '4px',
              border: '1px solid #E2E8F0',
              position: 'relative',
              overflow: 'hidden',
              minHeight: '200mm',
              // Watermark (only when the admin has set a logo under Bill Branding & Settings)
              ...(branding?.logoDataUrl ? {
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  bottom: '25mm',
                  left: '10mm',
                  width: '85mm',
                  height: '52mm',
                  backgroundImage: `url("${branding.logoDataUrl}")`,
                  backgroundPosition: 'center',
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  opacity: 0.05,
                  pointerEvents: 'none',
                  zIndex: 0,
                },
              } : {}),
            }}
          >
            {/* Accent bar */}
            <Box sx={{ height: '4px', bgcolor: branding?.accentColor || '#F0B90B', mb: { xs: 1, sm: 2 }, zIndex: 1, position: 'relative' }} />

            {/* Header Content — shorter on mobile's on-screen preview only (xs); the exported
                PDF/print always captures at the 'sm' width (see utils/billPdf.ts's windowWidth
                override) so the actual invoice's header is untouched. Width unchanged either way. */}
            <Box sx={{ borderBottom: '3px double #CBD5E1', pb: { xs: 1, sm: 2 }, mb: { xs: 1.5, sm: 2 }, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 1, sm: 1.5 } }}>
              {/* Fixed, identical size for both slots — whether one, both, or neither is set, the
                  company name in the middle stays centered instead of drifting toward the empty side. */}
              <Box sx={{ flex: '0 0 30mm', width: '30mm', height: { xs: '15mm', sm: '22.5mm' }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {branding?.headerLeftImageDataUrl && (
                  <Box component="img" src={branding.headerLeftImageDataUrl} alt="" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <Typography variant="h4" sx={{ fontWeight: 800, color: branding?.primaryColor || '#0B2B5E', letterSpacing: '0.5px', textTransform: 'uppercase', fontSize: { xs: '1.4rem', sm: '2.1rem' } }}>
                  {branding?.companyName || 'Transport Manager'}
                </Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#8a8a8a', letterSpacing: '2px', textTransform: 'uppercase', mt: 0.5, fontSize: { xs: '0.7rem', sm: '0.9rem' } }}>
                  {branding?.tagline || 'Transport & Logistics Solutions'}
                </Typography>
                {(branding?.proprietorName || branding?.phone1 || branding?.phone2) && (
                  <Typography variant="body2" sx={{ mt: { xs: 0.5, sm: 1 }, color: '#555', fontSize: '9pt', fontWeight: 500 }}>
                    {[
                      branding?.proprietorName ? `Prop.: ${branding.proprietorName}` : '',
                      [branding?.phone1, branding?.phone2].filter(Boolean).join(' / ') ? `Mob.: ${[branding?.phone1, branding?.phone2].filter(Boolean).join(' / ')}` : '',
                    ].filter(Boolean).join('  |  ')}
                  </Typography>
                )}
              </Box>
              <Box sx={{ flex: '0 0 30mm', width: '30mm', height: { xs: '15mm', sm: '22.5mm' }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {branding?.headerRightImageDataUrl && (
                  <Box component="img" src={branding.headerRightImageDataUrl} alt="" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                )}
              </Box>
            </Box>

            {/* Invoice Info Layout */}
            <Grid container spacing={2} sx={{ mb: 3, fontSize: '9.5pt', color: '#333', zIndex: 1, position: 'relative' }}>
              <Grid item xs={12} sm={6}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600, width: '70px' }}>M/s.:</td>
                      <td style={{ padding: '2px 0', fontWeight: 700, color: branding?.primaryColor || '#0B2B5E' }}>{customer.name}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600 }}>Address:</td>
                      <td style={{ padding: '2px 0' }}>{customer.address || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600 }}>Phone:</td>
                      <td style={{ padding: '2px 0' }}>{customer.phone || 'N/A'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600 }}>GST No.:</td>
                      <td style={{ padding: '2px 0' }}>{customerGst || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </Grid>
              <Grid item xs={12} sm={6}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600, width: '70px' }}>Bill No.:</td>
                      <td style={{ padding: '2px 0', fontWeight: 700, color: branding?.primaryColor || '#0B2B5E' }}>{billNo || '01'}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 8px 2px 0', color: '#666', fontWeight: 600 }}>Date:</td>
                      <td style={{ padding: '2px 0' }}>
                        {billDate
                          ? new Date(billDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Grid>
            </Grid>

            {/* Items Table */}
            <Box sx={{ width: '100%', overflowX: 'auto', mb: 3, zIndex: 1, position: 'relative' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', color: '#1a1a1a', minWidth: '500px' }}>
                <thead>
                  <tr style={{ backgroundColor: branding?.primaryColor || '#0B2B5E', color: '#ffffff' }}>
                    <th style={{ padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'center', width: '15%' }}>Date</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'left', width: '25%' }}>Pickup</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'left', width: '25%' }}>Drop</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'right', width: '17%' }}>Paid</th>
                    <th style={{ padding: '6px 8px', border: '1px solid #E2E8F0', textAlign: 'right', width: '18%' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {billTrips.map((trip, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                      <td style={{ padding: '5px 8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                        {new Date(trip.date).toLocaleDateString('en-IN')}
                      </td>
                      <td style={{ padding: '5px 8px', border: '1px solid #E2E8F0' }}>{trip.pickupLocation}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #E2E8F0' }}>{trip.dropLocation}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #E2E8F0', textAlign: 'right' }}>
                        ₹{(trip.paidAmount || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '5px 8px', border: '1px solid #E2E8F0', textAlign: 'right' }}>
                        ₹{trip.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {/* Subtotal Row */}
                  <tr>
                    <td colSpan={3} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: branding?.primaryColor || '#0B2B5E' }}>Sub Total</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: branding?.primaryColor || '#0B2B5E' }}>
                      ₹{billTotals.received.toFixed(2)}
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: branding?.primaryColor || '#0B2B5E' }}>
                      ₹{billTotals.subTotal.toFixed(2)}
                    </td>
                  </tr>
                  {billTotals.discount > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: '#A61B1B' }}>Discount</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#A61B1B' }}>
                        - ₹{billTotals.discount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {billTotals.gstEnabled && (
                    <tr>
                      <td colSpan={4} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: '#0B4EA6' }}>GST ({billTotals.gstPct}%)</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#0B4EA6' }}>
                        + ₹{billTotals.gstAmount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {(billTotals.discount > 0 || billTotals.gstEnabled) && (
                    <tr style={{ backgroundColor: '#F1F1F1' }}>
                      <td colSpan={4} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#1a1a1a' }}>Grand Total</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#1a1a1a' }}>
                        ₹{billTotals.grandTotal.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {billTotals.received > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: '#7A5A00' }}>Less: Amount Received</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#7A5A00' }}>
                        - ₹{billTotals.received.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {billTotals.advanceApplied > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 700, textAlign: 'right', color: '#7A5A00' }}>Less: Advance Balance Applied</td>
                      <td style={{ padding: '6px 8px', border: '1px solid #E2E8F0', fontWeight: 800, textAlign: 'right', color: '#7A5A00' }}>
                        - ₹{billTotals.advanceApplied.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {billTotals.showBreakdown && (
                    <tr style={{ backgroundColor: '#EBF5EC' }}>
                      <td colSpan={4} style={{ padding: '8px 8px', border: '1px solid #E2E8F0', fontWeight: 900, textAlign: 'right', color: '#0B5E1F', fontSize: '10pt' }}>NET PAYABLE</td>
                      <td style={{ padding: '8px 8px', border: '1px solid #E2E8F0', fontWeight: 900, textAlign: 'right', color: '#0B5E1F', fontSize: '10.5pt' }}>
                        ₹{billTotals.netPayable.toFixed(2)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Box>

            {/* Word Amount (+ optional UPI QR to its right) */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 3, zIndex: 1, position: 'relative' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ p: 1, bgcolor: '#fcfcfc', border: '1px dashed #ddd', borderRadius: '4px', fontSize: '9pt', color: '#555' }}>
                  <strong>Amount in Words:</strong> &nbsp;
                  <span style={{ fontStyle: 'italic', textTransform: 'capitalize' }}>
                    {amountInWords.trim() || `${convertNumberToWords(Math.round(billTotals.showBreakdown ? billTotals.netPayable : billTotals.subTotal))} Rupees Only`}
                  </span>
                </Box>
                {billTotals.advanceApplied > 0 && (
                  <Box sx={{ mt: 1, fontSize: '8.5pt', color: '#555' }}>
                    Advance balance remaining after this bill: <strong>₹{(billTotals.advanceAvailable - billTotals.advanceApplied).toFixed(2)}</strong>
                  </Box>
                )}
              </Box>
              {shouldShowUpiQr(branding, isGstBill) && (
                <Box sx={{ flex: '0 0 90px', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box component="img" src={branding?.upiQrImageDataUrl} alt="UPI QR" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </Box>
              )}
            </Box>

            {/* Footer Bank details + signature + closing note — kept as one unbreakable unit so
                a PDF page boundary never lands mid-signature (see renderBillNodeToA4Pdf). */}
            <Box data-keep-together="true">
            <Box sx={{ borderTop: '2px double #CBD5E1', pt: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 3, fontSize: '9pt', color: '#444', zIndex: 1, position: 'relative' }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: branding?.primaryColor || '#0B2B5E', mb: 0.5 }}>BANK DETAILS</Typography>
                <table style={{ width: '100%', fontSize: '8.5pt' }}>
                  <tbody>
                    <tr>
                      <td style={{ color: '#666', fontWeight: 600, width: '100px' }}>Bank Name:</td>
                      <td style={{ fontWeight: 500 }}>{bankName.trim() || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', fontWeight: 600 }}>Branch:</td>
                      <td style={{ fontWeight: 500 }}>{branch.trim() || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', fontWeight: 600 }}>Account No:</td>
                      <td style={{ fontWeight: 700, color: '#111' }}>{accountNumber.trim() || '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', fontWeight: 600 }}>IFSC Code:</td>
                      <td style={{ fontWeight: 700, color: '#111' }}>{ifscCode.trim() || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </Box>
              <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'flex-end' }, minWidth: '150px' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#333', fontStyle: 'italic', mb: 1 }}>
                  For {branding?.companyName || 'Transport Manager'}
                </Typography>
                {branding?.signatureDataUrl ? (
                  <Box component="img" src={branding.signatureDataUrl} alt="Signature" sx={{ maxWidth: 140, maxHeight: 50, objectFit: 'contain', mb: 0.5 }} />
                ) : (
                  <Box sx={{ height: 38 }} />
                )}
                <Typography variant="body2" sx={{ fontWeight: 700, borderTop: '1px solid #666', pt: 0.5, width: '140px', textAlign: 'center', fontSize: '8.5pt' }}>
                  Authorized Signatory
                </Typography>
              </Box>
            </Box>

            {/* Footer note */}
            <Box sx={{ textAlign: 'center', mt: 2.5, zIndex: 1, position: 'relative' }}>
              <Typography variant="body2" sx={{ color: '#888', fontStyle: 'italic', fontSize: '8.5pt' }}>
                {branding?.footerNote || 'Thank you for your business!'}
              </Typography>
            </Box>
            </Box>
          </Box>
          </Box>
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            p: { xs: 1.5, sm: 2 },
            pb: { xs: 'calc(12px + env(safe-area-inset-bottom))', sm: 'calc(16px + env(safe-area-inset-bottom))' },
            bgcolor: '#f5f5f5',
            borderTop: '1px solid #ddd',
            gap: 1,
            flexWrap: 'wrap',
            '& > button': { flex: { xs: '1 1 calc(50% - 8px)', sm: '0 0 auto' } },
          }}
        >
          <Button
            variant="outlined"
            onClick={handleSaveToMyBills}
            disabled={savingBillRecord}
            startIcon={<Bookmark />}
            sx={{ fontWeight: 700 }}
          >
            {savingBillRecord ? 'Saving...' : 'Save to My Bills'}
          </Button>

          <Button
            variant="outlined"
            onClick={() => setIsPreviewOpen(false)}
            color="secondary"
            sx={{ fontWeight: 600 }}
          >
            Close
          </Button>

          {Capacitor.isNativePlatform() && (
            <Button
              variant="outlined"
              onClick={handleShareBill}
              color="primary"
              startIcon={<ShareIcon />}
              sx={{ fontWeight: 700 }}
            >
              Share Summary
            </Button>
          )}

          <Button
            variant="outlined"
            onClick={() => promptSaveBill('whatsapp')}
            disabled={sharingBill}
            startIcon={<WhatsApp />}
            sx={{ fontWeight: 700, color: '#25D366', borderColor: '#25D366' }}
          >
            {sharingBill ? 'Preparing PDF...' : 'WhatsApp'}
          </Button>

          {customer?.email && (
            <Button
              variant="outlined"
              onClick={() => promptSaveBill('email')}
              disabled={sendingEmail}
              startIcon={<Email />}
              sx={{ fontWeight: 700 }}
            >
              {sendingEmail ? 'Sending...' : 'Email'}
            </Button>
          )}

          <Button
            variant="contained"
            onClick={() => promptSaveBill('print')}
            color="primary"
            startIcon={<Print />}
            sx={{ fontWeight: 700, color: '#000' }}
          >
            Print / Save PDF
          </Button>
        </DialogActions>
      </Dialog>

      {/* Save Bill Prompt — shown before Print/WhatsApp/Email */}
      <Dialog open={Boolean(saveBillPrompt)} onClose={() => setSaveBillPrompt(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Save Bill?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Would you like to save this bill to your records? You can also set an optional bill number.
          </Typography>
          <TextField
            label="Bill Number (optional)"
            value={saveBillPromptBillNo}
            onChange={e => setSaveBillPromptBillNo(e.target.value)}
            fullWidth
            size="small"
            placeholder={billNo || '01'}
            sx={{ mb: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexDirection: 'column' }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => handleSaveBillPromptProceed(true)}
            disabled={savingBillRecord}
            startIcon={<Bookmark />}
            sx={{ fontWeight: 700, color: 'primary.contrastText' }}
          >
            {savingBillRecord ? 'Saving...' : 'Yes, Save & Continue'}
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => handleSaveBillPromptProceed(false)}
            color="warning"
            sx={{ fontWeight: 600 }}
          >
            No, Just Generate PDF
          </Button>
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', mt: 0.5 }}>
            If you choose "No", the bill will not be saved in your records or database.
          </Typography>
        </DialogActions>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={isEditCustomerOpen} onClose={() => setIsEditCustomerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Customer</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
            <TextField
              label="Name"
              value={editCustomerForm.name}
              onChange={e => setEditCustomerForm(prev => ({ ...prev, name: e.target.value }))}
              fullWidth
              autoFocus
            />
            <TextField
              label="Phone"
              value={editCustomerForm.phone}
              onChange={e => setEditCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Address"
              value={editCustomerForm.address}
              onChange={e => setEditCustomerForm(prev => ({ ...prev, address: e.target.value }))}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsEditCustomerOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveCustomerEdit} variant="contained" disabled={savingCustomerEdit} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {savingCustomerEdit ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Similar-name collision warning */}
      <Dialog open={Boolean(collisionMatch)} onClose={() => { setCollisionMatch(null); setPendingCustomerEdit(null); }} maxWidth="xs" fullWidth>
        <DialogTitle>This looks like a duplicate</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            "{pendingCustomerEdit?.name}" is very similar to an existing customer, "{collisionMatch?.name}".
            Are these the same customer?
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Merging moves all trips from this record onto "{collisionMatch?.name}" and removes this duplicate.
            Choose "Keep Separate" if they're genuinely two different customers who happen to have similar names.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => { setCollisionMatch(null); setPendingCustomerEdit(null); }}>Cancel</Button>
          <Button onClick={handleKeepAsSeparateCustomer} variant="outlined" disabled={savingCustomerEdit}>
            Keep Separate
          </Button>
          <Button onClick={handleMergeIntoExisting} variant="contained" color="warning" disabled={mergingCustomer} sx={{ fontWeight: 700 }}>
            {mergingCustomer ? 'Merging...' : `Merge into "${collisionMatch?.name}"`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Advance Payment Dialog */}
      <Dialog open={isAdvanceDialogOpen} onClose={() => setIsAdvanceDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Advance Payment</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Record money this customer has already paid ahead of any specific trip — it'll be available to
              draw down later when settling a trip's payment.
            </Typography>
            <TextField
              label="Amount"
              type="number"
              value={advanceAmountInput}
              onChange={e => setAdvanceAmountInput(e.target.value)}
              fullWidth
              autoFocus
              InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
            />
            <TextField
              label="Date"
              type="date"
              value={advanceDateInput}
              onChange={e => setAdvanceDateInput(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Note (optional)"
              value={advanceNote}
              onChange={e => setAdvanceNote(e.target.value)}
              fullWidth
              placeholder="e.g. Paid in cash on 25 July"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsAdvanceDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddAdvance} variant="contained" disabled={savingAdvance} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {savingAdvance ? 'Saving...' : 'Add Advance'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Advance Balance — full history (date, note, amount) behind the header button */}
      <Dialog open={isAdvanceHistoryOpen} onClose={() => setIsAdvanceHistoryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Advance Balance</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Savings sx={{ color: '#F0B90B' }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Available balance:</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: (customer.advanceBalance || 0) > 0 ? '#0ECB81' : 'text.primary' }}>
              ₹{(customer.advanceBalance || 0).toFixed(2)}
            </Typography>
            <Button
              size="small"
              startIcon={<Add />}
              onClick={() => { setIsAdvanceHistoryOpen(false); openAddAdvanceDialog(); }}
              sx={{ ml: 'auto', color: '#F0B90B', fontWeight: 700 }}
            >
              Add Advance Payment
            </Button>
          </Box>

          {/* Search + amount-range + date filters */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search by note, amount, or date..."
              value={advanceSearchTerm}
              onChange={e => setAdvanceSearchTerm(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><FilterAlt fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment> }}
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              <TextField
                label="Min Amount" type="number" size="small"
                value={advanceAmountMin} onChange={e => setAdvanceAmountMin(e.target.value)}
                sx={{ minWidth: 120, flex: 1 }}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
              />
              <TextField
                label="Max Amount" type="number" size="small"
                value={advanceAmountMax} onChange={e => setAdvanceAmountMax(e.target.value)}
                sx={{ minWidth: 120, flex: 1 }}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
              />
              <TextField
                label="From" type="date" size="small"
                value={advanceDateFrom} onChange={e => setAdvanceDateFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 140, flex: 1 }}
              />
              <TextField
                label="To" type="date" size="small"
                value={advanceDateTo} onChange={e => setAdvanceDateTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 140, flex: 1 }}
              />
              {isAdvanceFiltered && (
                <Button
                  size="small"
                  startIcon={<Clear />}
                  onClick={() => { setAdvanceSearchTerm(''); setAdvanceAmountMin(''); setAdvanceAmountMax(''); setAdvanceDateFrom(''); setAdvanceDateTo(''); }}
                  sx={{ color: 'text.secondary' }}
                >
                  Clear
                </Button>
              )}
            </Box>
          </Box>

          {activeAdvanceHistory.length > 0 ? (
            <List sx={{ p: 0 }}>
              {activeAdvanceHistory.map(entry => (
                <ListItem
                  key={entry.id}
                  disableGutters
                  sx={{ py: 1.25, px: 1.5, mb: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
                  secondaryAction={
                    <Tooltip title="Delete this advance payment">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => setDeleteAdvanceEntry({ id: entry.id, amount: entry.amount, note: entry.note })}
                        sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemText
                    sx={{ pr: 5 }}
                    primary={
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {new Date(entry.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })}
                        </Typography>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0ECB81' }}>
                          +₹{entry.amount.toFixed(2)}
                        </Typography>
                      </Box>
                    }
                    secondary={entry.note || 'No note'}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Alert severity="info">{isAdvanceFiltered ? 'No advance payments match these filters.' : 'No advance payments recorded yet.'}</Alert>
          )}

          {deletedAdvanceHistory.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
                Deleted Payments (kept for record only)
              </Typography>
              <List sx={{ p: 0 }}>
                {deletedAdvanceHistory.map(entry => (
                  <ListItem
                    key={entry.id}
                    disableGutters
                    sx={{ py: 1, px: 1.5, mb: 1, borderRadius: 1.5, border: '1px dashed', borderColor: 'divider', opacity: 0.65 }}
                    secondaryAction={
                      <Tooltip title="Permanently delete this record">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => setPermanentDeleteEntry({ id: entry.id, amount: entry.amount, note: entry.note })}
                          sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <ListItemText
                      sx={{ pr: 5 }}
                      primary={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: entry.usedInBillNo ? 'none' : 'line-through' }}>
                            {new Date(entry.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })}
                          </Typography>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800, textDecoration: entry.usedInBillNo ? 'none' : 'line-through', color: 'text.secondary' }}>
                            +₹{entry.amount.toFixed(2)}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        entry.usedInBillNo
                          ? `Used in bill (Bill #${entry.usedInBillNo})`
                          : `${entry.note || 'No note'}${entry.deletedAt ? ` · Deleted ${new Date(entry.deletedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })}` : ''}`
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsAdvanceHistoryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete-advance confirmation — stacks on top of the history dialog above */}
      <Dialog open={Boolean(deleteAdvanceEntry)} onClose={() => setDeleteAdvanceEntry(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Advance Payment?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Are you sure you want to delete this ₹{deleteAdvanceEntry?.amount.toFixed(2)} advance
            {deleteAdvanceEntry?.note ? ` ("${deleteAdvanceEntry.note}")` : ''}? This will also subtract it from the
            available advance balance and cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAdvanceEntry(null)}>Cancel</Button>
          <Button
            onClick={handleConfirmDeleteAdvance}
            variant="contained"
            color="error"
            disabled={deletingAdvance}
            sx={{ fontWeight: 700 }}
          >
            {deletingAdvance ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Permanent delete confirmation — irreversible, so it gets a stronger warning */}
      <Dialog open={Boolean(permanentDeleteEntry)} onClose={() => setPermanentDeleteEntry(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Permanently Delete This Record?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will be permanently deleted and cannot be restored.
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Are you sure you want to permanently delete this ₹{permanentDeleteEntry?.amount.toFixed(2)} record
            {permanentDeleteEntry?.note ? ` ("${permanentDeleteEntry.note}")` : ''}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermanentDeleteEntry(null)}>Cancel</Button>
          <Button
            onClick={handleConfirmPermanentDelete}
            variant="contained"
            color="error"
            disabled={permanentlyDeletingAdvance}
            sx={{ fontWeight: 700 }}
          >
            {permanentlyDeletingAdvance ? 'Deleting...' : 'Yes, Delete Permanently'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Trip History "Download Bill" — ask whether to apply the advance balance first, since a
          single-trip bill is often for a different purpose than the main aggregated bill. */}
      <Dialog open={Boolean(tripBillAdvancePrompt)} onClose={() => setTripBillAdvancePrompt(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Apply Advance Balance?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This customer has ₹{(customer.advanceBalance || 0).toFixed(2)} in advance balance. Should it be applied
            against this trip's bill?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTripBillAdvancePrompt(null)}>Cancel</Button>
          <Button
            onClick={() => { if (tripBillAdvancePrompt) generateTripBillDownload(tripBillAdvancePrompt, false); setTripBillAdvancePrompt(null); }}
            variant="outlined"
          >
            No, Skip
          </Button>
          <Button
            onClick={() => { if (tripBillAdvancePrompt) generateTripBillDownload(tripBillAdvancePrompt, true); setTripBillAdvancePrompt(null); }}
            variant="contained"
            sx={{ color: 'primary.contrastText', fontWeight: 700 }}
          >
            Yes, Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CustomerDetails;


