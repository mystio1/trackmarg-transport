import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, GridLegacy as Grid, Card, CardContent,
  IconButton, Chip, List, Avatar, Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Alert, TextField, useTheme, ToggleButtonGroup, ToggleButton,
  Select, MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  ArrowBack, Phone, LocalShipping, ErrorOutline, VpnKey,
  CalendarMonth, LocationOn, CheckCircle, Cancel, Person, ChevronRight, ChevronLeft, Clear,
  Edit, Add, DeleteOutline, Info,
} from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import { BUSINESS_EFFECT_LABEL } from '../types';
import type { BusinessEffect, DriverTransaction, DriverMonthSalary, DriverLifetimeSalary, Trip } from '../types';

const todayLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fmt = (value: number) => `₹${value.toFixed(2)}`;
const fmtDate = (value: string | Date) => new Date(value).toLocaleDateString('en-IN');
const MONTH_LABEL = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });

type DriverTab = 'overview' | 'money' | 'salary' | 'trips';

const DriverDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const {
    drivers, getDriverTrips, resetDriverPassword,
    updateDriverSalary, fetchDriverFinance,
    addDriverTransaction, updateDriverTransaction, deleteDriverTransaction,
  } = useAppContext();
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Only used by the Trips tab now — Overview/Money/Salary have their own date semantics
  // (lifetime, unfiltered, and month-navigable respectively), matching the reference payroll
  // feature this was ported from.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const isDateFiltered = Boolean(dateFrom || dateTo);

  // Salary is the default view whenever this page is opened.
  const [tab, setTab] = useState<DriverTab>('salary');

  const today = new Date();
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const monthDate = new Date(monthCursor.year, monthCursor.month - 1, 1);

  const driver = drivers.find(d => d.id === id);

  const [transactions, setTransactions] = useState<DriverTransaction[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [salary, setSalary] = useState<DriverMonthSalary | null>(null);
  const [lifetimeSalary, setLifetimeSalary] = useState<DriverLifetimeSalary | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);

  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [salaryInput, setSalaryInput] = useState('');
  const [joiningDateInput, setJoiningDateInput] = useState('');
  const [salaryError, setSalaryError] = useState('');
  const [savingSalary, setSavingSalary] = useState(false);

  const [accrualDialogOpen, setAccrualDialogOpen] = useState(false);

  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [txCategoryId, setTxCategoryId] = useState('');
  const [txCustomMode, setTxCustomMode] = useState(false);
  const [txCustomInput, setTxCustomInput] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txDate, setTxDate] = useState(todayLocalDateString());
  const [txDeductFromSalary, setTxDeductFromSalary] = useState(true);
  const [txBusinessEffect, setTxBusinessEffect] = useState<BusinessEffect>('ADVANCE_RECOVERABLE');
  const [txError, setTxError] = useState('');
  const [savingTx, setSavingTx] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    setFinanceLoading(true);
    fetchDriverFinance(driver.id, monthCursor)
      .then((data) => {
        if (cancelled) return;
        setTransactions(data.transactions);
        setCategories(data.categories);
        setSalary(data.salary);
        setLifetimeSalary(data.lifetimeSalary);
      })
      .catch(() => {
        if (cancelled) return;
        setTransactions([]);
        setSalary(null);
        setLifetimeSalary(null);
      })
      .finally(() => { if (!cancelled) setFinanceLoading(false); });
    return () => { cancelled = true; };
    // Keyed on driver.id and the month cursor only. Not driver (a global refreshData() tick gives
    // `drivers` a new array reference — same reasoning as AppContext's user?.id effect
    // dependency) and not fetchDriverFinance (AppContext's action methods are plain functions
    // re-created on every AppProvider render — including it here would restart this effect, and
    // cancel the in-flight fetch, on every unrelated context re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id, monthCursor.year, monthCursor.month]);

  if (!driver) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <ErrorOutline sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom color="error.main">Driver Not Found</Typography>
        <Typography variant="body1" sx={{ mb: 4 }}>This driver doesn't exist in your group (or hasn't loaded yet).</Typography>
        <IconButton onClick={() => navigate('/drivers')} sx={{ bgcolor: 'action.hover' }} aria-label="back">
          <ArrowBack />
        </IconButton>
      </Box>
    );
  }

  const allDriverTrips = [...getDriverTrips(driver.id)].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const fromBound = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const toBound = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
  const driverTrips = allDriverTrips.filter(t => {
    const tripDate = new Date(t.date);
    if (fromBound && tripDate < fromBound) return false;
    if (toBound && tripDate > toBound) return false;
    return true;
  });

  const tripsTotalAmount = driverTrips.reduce((s, t) => s + Number(t.amount || 0), 0);
  const tripsTotalAdvance = driverTrips.reduce((s, t) => s + Number(t.advanceAmount || 0), 0);
  const tripsPendingAmount = driverTrips.filter(t => !t.isPaid).reduce((s, t) => s + Number(t.amount || 0), 0);

  const refreshFinance = async () => {
    try {
      const data = await fetchDriverFinance(driver.id, monthCursor);
      setTransactions(data.transactions);
      setCategories(data.categories);
      setSalary(data.salary);
      setLifetimeSalary(data.lifetimeSalary);
    } catch {
      // Keep whatever was already on screen rather than blanking it out on a transient error.
    }
  };

  const goToPrevMonth = () => {
    setMonthCursor(({ year, month }) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }));
  };
  const goToNextMonth = () => {
    setMonthCursor(({ year, month }) => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }));
  };

  const openResetDialog = () => {
    setNewPassword('');
    setResetError('');
    setResetSuccess(false);
    setResetDialogOpen(true);
  };

  const handleResetPassword = async () => {
    setResetError('');
    if (newPassword.length < 6) return setResetError('Password must be at least 6 characters');
    setResetting(true);
    try {
      await resetDriverPassword(driver.id, newPassword);
      setResetSuccess(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setResetting(false);
    }
  };

  const openSalaryDialog = () => {
    setSalaryInput(driver.baseSalary ? String(driver.baseSalary) : '');
    setJoiningDateInput(driver.joiningDate ? driver.joiningDate.slice(0, 10) : '');
    setSalaryError('');
    setSalaryDialogOpen(true);
  };

  const handleSaveSalary = async () => {
    setSalaryError('');
    const value = Number(salaryInput);
    if (!Number.isFinite(value) || value < 0) return setSalaryError('Enter a valid amount');
    setSavingSalary(true);
    try {
      await updateDriverSalary(driver.id, value, joiningDateInput || null);
      setSalaryDialogOpen(false);
      await refreshFinance();
    } catch (err) {
      setSalaryError(err instanceof Error ? err.message : 'Could not update salary');
    } finally {
      setSavingSalary(false);
    }
  };

  const openAddTxDialog = () => {
    setEditingTxId(null);
    const defaultCategory = categories.find(c => c.name === 'Salary Advance') ?? categories[0];
    setTxCategoryId(defaultCategory?.id ?? '');
    setTxCustomMode(false);
    setTxCustomInput('');
    setTxAmount('');
    setTxNote('');
    setTxDate(todayLocalDateString());
    setTxDeductFromSalary(true);
    setTxBusinessEffect('ADVANCE_RECOVERABLE');
    setTxError('');
    setTxDialogOpen(true);
  };

  const openEditTxDialog = (entry: DriverTransaction) => {
    setEditingTxId(entry.id);
    setTxCategoryId(entry.categoryId ?? '');
    setTxCustomMode(false);
    setTxCustomInput('');
    setTxAmount(String(entry.amount));
    setTxNote(entry.note);
    setTxDate(entry.date.slice(0, 10));
    setTxDeductFromSalary(entry.deductFromSalary);
    setTxBusinessEffect(entry.businessEffect);
    setTxError('');
    setTxDialogOpen(true);
  };

  const handleSaveTransaction = async () => {
    setTxError('');
    const amount = Number(txAmount);
    if (!Number.isFinite(amount) || amount <= 0) return setTxError('Enter a valid amount');
    if (!txCustomMode && !txCategoryId) return setTxError('Category is required');
    if (txCustomMode && !txCustomInput.trim()) return setTxError('Category is required');
    setSavingTx(true);
    try {
      const input = {
        categoryId: txCustomMode ? undefined : txCategoryId,
        newCategoryName: txCustomMode ? txCustomInput.trim() : undefined,
        amount, note: txNote.trim(), date: txDate,
        deductFromSalary: txDeductFromSalary, businessEffect: txBusinessEffect,
      };
      if (editingTxId) await updateDriverTransaction(driver.id, editingTxId, input);
      else await addDriverTransaction(driver.id, input);
      setTxDialogOpen(false);
      await refreshFinance();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Could not save transaction');
    } finally {
      setSavingTx(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteDriverTransaction(driver.id, pendingDelete.id);
      setPendingDelete(null);
      await refreshFinance();
    } finally {
      setDeleting(false);
    }
  };

  const paperSx = { p: { xs: 2, sm: 3 }, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <IconButton onClick={() => navigate('/drivers')} sx={{ mr: 2, bgcolor: 'action.hover' }} aria-label="back">
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" component="h1" color="primary.dark" sx={{ fontWeight: 800, fontSize: { xs: '1.4rem', sm: '2.125rem' } }}>
          Driver Details
        </Typography>
      </Box>

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', width: 56, height: 56 }}>
              <LocalShipping fontSize="large" />
            </Avatar>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>{driver.name}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                <Phone sx={{ fontSize: 18, mr: 1, color: '#F0B90B' }} />
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>{driver.phone}</Typography>
              </Box>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, ml: 'auto', alignItems: 'center' }}>
            <Chip
              icon={<LocalShipping />}
              label={`${allDriverTrips.length} Trips`}
              sx={{ fontWeight: 600, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', border: '1px solid rgba(240, 185, 11, 0.2)' }}
            />
            {!driver.active && (
              <Chip label="Inactive" sx={{ fontWeight: 600, backgroundColor: 'rgba(246, 70, 93, 0.1)', color: '#F6465D' }} />
            )}
            <Button
              variant="outlined"
              size="small"
              startIcon={<Edit />}
              onClick={openSalaryDialog}
              sx={{ color: 'text.secondary', borderColor: 'divider', '&:hover': { borderColor: '#F0B90B', color: '#F0B90B' } }}
            >
              Edit Salary
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<VpnKey />}
              onClick={openResetDialog}
              sx={{ color: 'text.secondary', borderColor: 'divider', '&:hover': { borderColor: '#F0B90B', color: '#F0B90B' } }}
            >
              Reset Password
            </Button>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', overflowX: 'auto' }}>
        <ToggleButtonGroup
          value={tab}
          exclusive
          onChange={(_, value: DriverTab | null) => value && setTab(value)}
          sx={{
            bgcolor: 'action.hover',
            borderRadius: 2,
            p: 0.5,
            gap: 0.5,
            '& .MuiToggleButtonGroup-grouped': { border: 'none', borderRadius: '10px !important' },
            '& .MuiToggleButton-root': {
              px: { xs: 1.5, sm: 3 },
              py: 1,
              fontWeight: 700,
              textTransform: 'none',
              whiteSpace: 'nowrap',
              color: 'text.secondary',
              transition: 'background-color 0.15s ease-in-out, color 0.15s ease-in-out',
              '&:hover': { bgcolor: 'divider' },
              '&.Mui-selected': {
                bgcolor: '#F0B90B',
                color: '#000',
                '&:hover': { bgcolor: '#F0B90B' },
              },
            },
          }}
        >
          <ToggleButton value="overview">Overview</ToggleButton>
          <ToggleButton value="money">Money</ToggleButton>
          <ToggleButton value="salary">Salary</ToggleButton>
          <ToggleButton value="trips">Trips</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {tab === 'trips' && (
        <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600, mr: 0.5 }}>
              Filter by date:
            </Typography>
            <TextField
              label="From" type="date" size="small"
              value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="To" type="date" size="small"
              value={dateTo} onChange={e => setDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
            />
            {isDateFiltered && (
              <Button
                size="small"
                startIcon={<Clear />}
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                sx={{ color: 'text.secondary' }}
              >
                Clear
              </Button>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', ml: { sm: 'auto' } }}>
              {isDateFiltered
                ? `Showing ${driverTrips.length} of ${allDriverTrips.length} trip${allDriverTrips.length === 1 ? '' : 's'}`
                : `Showing all ${allDriverTrips.length} trip${allDriverTrips.length === 1 ? '' : 's'}`}
            </Typography>
          </Box>
        </Paper>
      )}

      {tab === 'overview' && (
        <>
          <Paper elevation={0} sx={paperSx}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ color: 'text.secondary', fontWeight: 600 }}>Monthly Salary</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '1.4rem' }}>{fmt(driver.baseSalary || 0)}</Typography>
            </Box>
          </Paper>

          <Paper elevation={0} sx={paperSx}>
            {financeLoading ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading…</Typography>
            ) : lifetimeSalary ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Since Joining ({fmtDate(lifetimeSalary.joiningDate)} – {fmtDate(lifetimeSalary.asOf)})
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Total Payable Salary</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{fmt(lifetimeSalary.totalPayable)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Salary Given</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{fmt(lifetimeSalary.totalPaid)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, pt: 1.25, borderTop: `1px solid ${theme.palette.divider}` }}>
                  <Typography sx={{ fontWeight: 700 }}>Remaining{lifetimeSalary.remaining < 0 ? ' (overpaid)' : ''}</Typography>
                  <Typography sx={{ fontWeight: 800, color: lifetimeSalary.remaining > 0 ? '#F0B90B' : lifetimeSalary.remaining < 0 ? '#F6465D' : 'text.primary' }}>
                    {fmt(lifetimeSalary.remaining)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<Info fontSize="small" />}
                  onClick={() => setAccrualDialogOpen(true)}
                  sx={{ alignSelf: 'flex-start', color: '#F0B90B', mt: 0.5 }}
                >
                  Detail
                </Button>
              </Box>
            ) : null}
          </Paper>
        </>
      )}

      {tab === 'money' && (
        <Paper elevation={0} sx={paperSx}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<Add />}
            onClick={openAddTxDialog}
            sx={{ bgcolor: '#F0B90B', color: '#000', fontWeight: 700, py: 1.2, mb: 2, '&:hover': { bgcolor: '#d9a60a' } }}
          >
            Add Money Transaction
          </Button>
          {financeLoading ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading…</Typography>
          ) : transactions.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>No transactions yet.</Typography>
          ) : (
            <List sx={{ p: 0 }}>
              {transactions.map((entry, index) => (
                <Box key={entry.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 1.25, px: 1.5, mb: 1, borderRadius: 1.5, bgcolor: index % 2 === 0 ? 'action.hover' : 'transparent' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>{entry.categoryName}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{fmtDate(entry.date)}</Typography>
                    {entry.note && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{entry.note}</Typography>}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ textAlign: 'right', mr: 0.5 }}>
                      <Typography sx={{ fontWeight: 700 }}>{fmt(entry.amount)}</Typography>
                      <Chip
                        label={entry.deductFromSalary ? 'Deducted' : 'Not deducted'}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20, borderColor: 'divider', color: 'text.secondary' }}
                      />
                    </Box>
                    <IconButton size="small" aria-label="edit transaction" onClick={() => openEditTxDialog(entry)} sx={{ color: 'text.secondary', '&:hover': { color: '#F0B90B' } }}>
                      <Edit fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="delete transaction"
                      onClick={() => setPendingDelete({ id: entry.id, label: `${entry.categoryName} · ${fmt(entry.amount)}` })}
                      sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </List>
          )}
        </Paper>
      )}

      {tab === 'salary' && (
        <>
          <Paper elevation={0} sx={{ ...paperSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: { xs: 1.5, sm: 2 } }}>
            <IconButton onClick={goToPrevMonth} size="small" aria-label="previous month" sx={{ border: `1px solid ${theme.palette.divider}` }}>
              <ChevronLeft />
            </IconButton>
            <Typography sx={{ fontWeight: 700 }}>{MONTH_LABEL.format(monthDate)}</Typography>
            <IconButton onClick={goToNextMonth} size="small" aria-label="next month" sx={{ border: `1px solid ${theme.palette.divider}` }}>
              <ChevronRight />
            </IconButton>
          </Paper>

          <Paper elevation={0} sx={paperSx}>
            {financeLoading ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading…</Typography>
            ) : salary ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Monthly Salary</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{fmt(salary.baseSalary)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Bonus / Incentive</Typography>
                  <Typography sx={{ fontWeight: 700, color: '#0ECB81' }}>+{fmt(salary.bonus)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Total Deductions</Typography>
                  <Typography sx={{ fontWeight: 700, color: '#F6465D' }}>-{fmt(salary.deductions)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: 'text.secondary' }}>Already Paid</Typography>
                  <Typography sx={{ fontWeight: 700 }}>-{fmt(salary.alreadyPaid)}</Typography>
                </Box>
                {salary.carriedForward !== 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1.25, borderTop: `1px solid ${theme.palette.divider}` }}>
                    <Typography sx={{ color: 'text.secondary' }}>
                      Carried Forward {salary.carriedForward > 0 ? '(unpaid earlier)' : '(overpaid earlier)'}
                    </Typography>
                    <Typography sx={{ fontWeight: 700, color: salary.carriedForward > 0 ? '#0ECB81' : '#F6465D' }}>
                      {salary.carriedForward > 0 ? '+' : ''}{fmt(salary.carriedForward)}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, pt: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Remaining Payable</Typography>
                  <Typography sx={{ fontWeight: 900, fontSize: '1.2rem', color: '#F0B90B' }}>{fmt(salary.payable)}</Typography>
                </Box>
              </Box>
            ) : null}
          </Paper>
        </>
      )}

      {tab === 'trips' && (
        <>
          <Grid container spacing={{ xs: 1.5, sm: 3 }}>
            <Grid item xs={4}>
              <Card sx={{ height: '100%', borderRadius: 2, background: 'background.paper', borderTop: `3px solid ${theme.palette.divider}`, color: 'text.primary' }}>
                <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
                  <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>Total Trips</Typography>
                  <Typography sx={{ color: 'text.primary', fontWeight: 800, fontSize: { xs: '1.3rem', sm: '2.2rem' } }}>{driverTrips.length}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card sx={{ height: '100%', borderRadius: 2, background: 'background.paper', borderTop: '3px solid #0ECB81', color: 'text.primary' }}>
                <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
                  <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>Revenue Generated</Typography>
                  <Typography sx={{ color: 'text.primary', fontWeight: 800, fontSize: { xs: '0.95rem', sm: '2.2rem' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(tripsTotalAmount)}</Typography>
                  {tripsTotalAdvance > 0 && (
                    <Typography sx={{ color: 'text.secondary', mt: 1, fontWeight: 500, fontSize: { xs: '0.65rem', sm: '0.875rem' }, display: { xs: 'none', sm: 'block' } }}>
                      Advance collected: {fmt(tripsTotalAdvance)}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={4}>
              <Card sx={{ height: '100%', borderRadius: 2, background: 'background.paper', borderTop: '3px solid #F6465D', color: 'text.primary' }}>
                <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
                  <Typography gutterBottom sx={{ color: 'text.secondary', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '1rem' } }}>Pending (Net Payable)</Typography>
                  <Typography sx={{ color: '#F6465D', fontWeight: 800, fontSize: { xs: '0.95rem', sm: '2.2rem' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(tripsPendingAmount)}</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, mb: 3, color: 'text.primary' }}>
              Trips Done by {driver.name}
            </Typography>
            {driverTrips.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                <LocalShipping sx={{ fontSize: 48, mb: 1 }} />
                <Typography>
                  {isDateFiltered
                    ? `No trips for ${driver.name} in this date range.`
                    : `No trips recorded yet for ${driver.name}.`}
                </Typography>
              </Box>
            ) : (
              <List sx={{ p: 0 }}>
                {driverTrips.map((trip, index) => (
                  <Box
                    key={trip.id}
                    onClick={() => setSelectedTrip(trip)}
                    sx={{
                      mb: 1.5, py: 2, px: 3, borderRadius: 2,
                      bgcolor: index % 2 === 0 ? 'action.hover' : 'background.paper',
                      border: `1px solid ${theme.palette.divider}`,
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease-in-out',
                      '&:hover': { bgcolor: 'divider' },
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 1, sm: 0 }, mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Person sx={{ mr: 1, color: '#F0B90B', fontSize: 20 }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                          {trip.customerName || 'Walk-in Customer'}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {fmt(Number(trip.amount || 0))}
                        </Typography>
                        <Chip
                          icon={trip.isPaid ? <CheckCircle /> : <Cancel />}
                          label={trip.isPaid ? 'Paid' : 'Unpaid'}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            backgroundColor: trip.isPaid ? 'rgba(14, 203, 129, 0.1)' : 'rgba(246, 70, 93, 0.1)',
                            color: trip.isPaid ? '#0ECB81' : '#F6465D',
                          }}
                        />
                        {trip.status === 'pending' && (
                          <Chip label="Awaiting Approval" size="small" sx={{ fontWeight: 600, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B' }} />
                        )}
                        <ChevronRight sx={{ color: 'text.secondary' }} />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <LocationOn sx={{ mr: 0.5, color: 'text.secondary', fontSize: 18 }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {trip.pickupLocation} → {trip.dropLocation}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <CalendarMonth sx={{ mr: 0.5, color: 'text.secondary', fontSize: 18 }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {fmtDate(trip.date)}
                        </Typography>
                      </Box>
                      {trip.materialType && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          Material: {trip.materialType}
                        </Typography>
                      )}
                      {typeof trip.advanceAmount === 'number' && trip.advanceAmount > 0 && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          Advance: {fmt(trip.advanceAmount)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </List>
            )}
          </Paper>
        </>
      )}

      {/* Trip Details — full record behind each trip card: material, vehicle, payment breakdown, status */}
      <Dialog open={Boolean(selectedTrip)} onClose={() => setSelectedTrip(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Trip Details</DialogTitle>
        <DialogContent>
          {selectedTrip && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Date</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {new Date(selectedTrip.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: '2-digit' })}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Status</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={selectedTrip.status === 'pending' ? 'Awaiting Approval' : selectedTrip.status === 'rejected' ? 'Rejected' : 'Approved'}
                    size="small"
                    sx={{
                      fontWeight: 700,
                      backgroundColor: selectedTrip.status === 'rejected' ? 'rgba(246, 70, 93, 0.1)' : selectedTrip.status === 'pending' ? 'rgba(240, 185, 11, 0.1)' : 'rgba(14, 203, 129, 0.1)',
                      color: selectedTrip.status === 'rejected' ? '#F6465D' : selectedTrip.status === 'pending' ? '#F0B90B' : '#0ECB81',
                    }}
                  />
                  <Chip
                    icon={selectedTrip.isPaid ? <CheckCircle /> : <Cancel />}
                    label={selectedTrip.isPaid ? 'Paid' : 'Unpaid'}
                    size="small"
                    sx={{
                      fontWeight: 700,
                      backgroundColor: selectedTrip.isPaid ? 'rgba(14, 203, 129, 0.1)' : 'rgba(246, 70, 93, 0.1)',
                      color: selectedTrip.isPaid ? '#0ECB81' : '#F6465D',
                    }}
                  />
                </Box>
              </Grid>
              {selectedTrip.status === 'rejected' && selectedTrip.rejectionReason && (
                <Grid item xs={12}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Rejection Reason</Typography>
                  <Typography variant="body1" sx={{ color: '#F6465D' }}>{selectedTrip.rejectionReason}</Typography>
                </Grid>
              )}
              <Grid item xs={12}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Customer</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>{selectedTrip.customerName || 'Walk-in Customer'}</Typography>
                {(selectedTrip.customerPhone || selectedTrip.customerAddress) && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {[selectedTrip.customerPhone, selectedTrip.customerAddress].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Pickup</Typography>
                <Typography variant="body1">{selectedTrip.pickupLocation || '—'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Drop</Typography>
                <Typography variant="body1">{selectedTrip.dropLocation || '—'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Vehicle Type</Typography>
                <Typography variant="body1">{selectedTrip.vehicleType || '—'}</Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Vehicle Number</Typography>
                <Typography variant="body1">{selectedTrip.vehicleNumber || '—'}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Material</Typography>
                <Typography variant="body1">{selectedTrip.materialType || 'Not specified'}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Amount</Typography>
                <Typography variant="body1" sx={{ fontWeight: 700 }}>{fmt(Number(selectedTrip.amount || 0))}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Advance (at booking)</Typography>
                <Typography variant="body1">{fmt(Number(selectedTrip.advanceAmount || 0))}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Paid So Far</Typography>
                <Typography variant="body1" sx={{ color: '#0ECB81', fontWeight: 700 }}>{fmt(Number(selectedTrip.paidAmount || 0))}</Typography>
              </Grid>
              {selectedTrip.paymentMode && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Payment Mode</Typography>
                  <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>{selectedTrip.paymentMode.replace('_', ' ')}</Typography>
                </Grid>
              )}
              {selectedTrip.paymentNote && (
                <Grid item xs={12}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Payment Note</Typography>
                  <Typography variant="body1">{selectedTrip.paymentNote}</Typography>
                </Grid>
              )}
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Driver</Typography>
                <Typography variant="body1">
                  {selectedTrip.driverName || driver.name}{selectedTrip.driverCode ? ` (${selectedTrip.driverCode})` : ''}
                </Typography>
              </Grid>
              {selectedTrip.submittedAt && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Submitted</Typography>
                  <Typography variant="body2">{new Date(selectedTrip.submittedAt).toLocaleString('en-IN')}</Typography>
                </Grid>
              )}
              {selectedTrip.approvedAt && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Approved</Typography>
                  <Typography variant="body2">{new Date(selectedTrip.approvedAt).toLocaleString('en-IN')}</Typography>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedTrip(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Reset a driver's password directly — drivers have no recovery email on file, so this is
          how they get back in if they forget it: tell them the new password yourself. */}
      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset Password for {driver.name}</DialogTitle>
        <DialogContent>
          {resetSuccess ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              Password reset. Share the new password with {driver.name} directly (call/WhatsApp) —
              it won't be shown again.
            </Alert>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {resetError && <Alert severity="error">{resetError}</Alert>}
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Set a new password for this driver. They'll need it (along with the group code) to log in.
              </Typography>
              <TextField
                label="New Password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                helperText="Minimum 6 characters"
                fullWidth
                autoFocus
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>{resetSuccess ? 'Close' : 'Cancel'}</Button>
          {!resetSuccess && (
            <Button variant="contained" onClick={handleResetPassword} disabled={resetting || !newPassword}>
              {resetting ? 'Resetting...' : 'Reset Password'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Set the driver's fixed base salary and joining date (when salary starts accruing from). */}
      <Dialog open={salaryDialogOpen} onClose={() => setSalaryDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Edit Salary for {driver.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {salaryError && <Alert severity="error">{salaryError}</Alert>}
            <TextField
              label="Monthly Salary (₹)"
              type="number"
              value={salaryInput}
              onChange={e => setSalaryInput(e.target.value)}
              inputProps={{ min: 0, step: '0.01' }}
              fullWidth
              autoFocus
            />
            <TextField
              label="Joining Date"
              type="date"
              value={joiningDateInput}
              onChange={e => setJoiningDateInput(e.target.value)}
              helperText="When salary starts accruing from. Leave blank to use when the driver's account was created."
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSalaryDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveSalary} disabled={savingSalary || salaryInput === ''}>
            {savingSalary ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Money Transaction — one unified flow for fines, deductions, advances, bonuses,
          salary payments, or any admin-defined category. */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>{editingTxId ? 'Edit Money Transaction' : 'Add Money Transaction'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {txError && <Alert severity="error">{txError}</Alert>}

            {!txCustomMode ? (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel id="tx-category-label">Category</InputLabel>
                  <Select
                    labelId="tx-category-label"
                    label="Category"
                    value={txCategoryId}
                    onChange={e => setTxCategoryId(e.target.value)}
                  >
                    {categories.map(cat => (
                      <MenuItem key={cat.id} value={cat.id}>{cat.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  size="small"
                  onClick={() => { setTxCustomMode(true); setTxCustomInput(''); }}
                  sx={{ alignSelf: 'flex-start', color: '#F0B90B', '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } }}
                >
                  + Add Custom Category
                </Button>
              </>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="New Category Name"
                  value={txCustomInput}
                  onChange={e => setTxCustomInput(e.target.value)}
                  fullWidth
                  size="small"
                  autoFocus
                />
                <Button size="small" onClick={() => setTxCustomMode(false)} sx={{ color: 'text.secondary', mt: 0.5 }}>
                  Cancel
                </Button>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField
                label="Amount (₹)" type="number"
                value={txAmount} onChange={e => setTxAmount(e.target.value)}
                inputProps={{ min: 0, step: '0.01' }}
                fullWidth
              />
              <TextField
                label="Date" type="date"
                value={txDate} onChange={e => setTxDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Box>

            <TextField
              label="Notes (Optional)"
              value={txNote} onChange={e => setTxNote(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={txDeductFromSalary}
                  onChange={e => setTxDeductFromSalary(e.target.checked)}
                  sx={{ color: 'text.secondary', '&.Mui-checked': { color: '#F0B90B' } }}
                />
              }
              label="Deduct this amount from salary?"
            />

            <FormControl fullWidth size="small">
              <InputLabel id="tx-effect-label">How should this affect the business account?</InputLabel>
              <Select
                labelId="tx-effect-label"
                label="How should this affect the business account?"
                value={txBusinessEffect}
                onChange={e => setTxBusinessEffect(e.target.value as BusinessEffect)}
              >
                {(Object.keys(BUSINESS_EFFECT_LABEL) as BusinessEffect[]).map(effect => (
                  <MenuItem key={effect} value={effect}>{BUSINESS_EFFECT_LABEL[effect]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTxDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveTransaction} disabled={savingTx || !txAmount} sx={{ bgcolor: '#F0B90B', color: '#000', fontWeight: 700, '&:hover': { bgcolor: '#d9a60a' } }}>
            {savingTx ? 'Saving...' : editingTxId ? 'Save Changes' : 'Save Transaction'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation — hard delete, no undo. */}
      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this transaction?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Deleting "{pendingDelete?.label}" will permanently remove it and update the salary calculation. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Yes, Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Overview tab's "How This Was Calculated" — the exact day-by-day accrual math behind the
          lifetime Since-Joining numbers, never re-derived on the client. */}
      <Dialog open={accrualDialogOpen} onClose={() => setAccrualDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>How This Was Calculated</DialogTitle>
        <DialogContent>
          {lifetimeSalary && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Joined {fmtDate(lifetimeSalary.joiningDate)}, calculated through today, {fmtDate(lifetimeSalary.asOf)}.
              </Typography>

              {lifetimeSalary.accrual.fullCycles > 0 && (
                <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {lifetimeSalary.accrual.fullCycles} full month{lifetimeSalary.accrual.fullCycles === 1 ? '' : 's'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {fmtDate(lifetimeSalary.joiningDate)} – {fmtDate(lifetimeSalary.accrual.cycleStart)}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {fmt(lifetimeSalary.baseSalary)} × {lifetimeSalary.accrual.fullCycles} = <b>{fmt(lifetimeSalary.accrual.fullCyclesAmount)}</b>
                  </Typography>
                </Box>
              )}

              {lifetimeSalary.accrual.elapsedDays > 0 && (
                <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {lifetimeSalary.accrual.elapsedDays} more day{lifetimeSalary.accrual.elapsedDays === 1 ? '' : 's'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {fmtDate(lifetimeSalary.accrual.cycleStart)} – {fmtDate(lifetimeSalary.asOf)}, inside the current {lifetimeSalary.accrual.cycleDays}-day cycle
                    {' '}({fmtDate(lifetimeSalary.accrual.cycleStart)} – {fmtDate(lifetimeSalary.accrual.cycleEnd)})
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {fmt(lifetimeSalary.baseSalary)} ÷ {lifetimeSalary.accrual.cycleDays} days = {fmt(lifetimeSalary.accrual.dailyRate)}/day × {lifetimeSalary.accrual.elapsedDays} = <b>{fmt(lifetimeSalary.accrual.partialAmount)}</b>
                  </Typography>
                </Box>
              )}

              {(lifetimeSalary.bonus > 0 || lifetimeSalary.deductions > 0) && (
                <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {lifetimeSalary.bonus > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">Bonus / Incentive</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#0ECB81' }}>+{fmt(lifetimeSalary.bonus)}</Typography>
                    </Box>
                  )}
                  {lifetimeSalary.deductions > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">Deductions</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#F6465D' }}>-{fmt(lifetimeSalary.deductions)}</Typography>
                    </Box>
                  )}
                </Box>
              )}

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>Total Payable</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(lifetimeSalary.totalPayable)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>Salary Given</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(lifetimeSalary.totalPaid)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontWeight: 700 }}>Remaining</Typography>
                  <Typography sx={{ fontWeight: 800 }}>{fmt(lifetimeSalary.remaining)}</Typography>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccrualDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverDetails;
