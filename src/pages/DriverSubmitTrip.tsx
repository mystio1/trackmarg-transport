import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  GridLegacy as Grid,
  InputAdornment,
  Paper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { PersonAdd, Send } from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import LoadingOverlay from '../components/LoadingOverlay';
import type { Customer } from '../types';

// A draft ("new customer") never has a real id yet — it only gets one once the admin approves
// the trip and the backend resolves/creates the matching customer record.
type DraftCustomer = { name: string; phone: string; address: string };
const EMPTY_NEW_CUSTOMER: DraftCustomer = { name: '', phone: '', address: '' };

const defaultTripFields = (vehicleNumber = '') => ({
  date: new Date(),
  pickupLocation: '',
  dropLocation: '',
  vehicleType: '',
  vehicleNumber,
  materialType: '',
  amount: '',
  advanceAmount: '',
  isPaid: false,
});

// Mirrors the admin's "Add Trip" page (customer picker + New Customer dialog + identical trip
// fields) — the only difference under the hood is that this goes through submitDriverTrip, which
// keeps the offline queue (submit with no signal, sync automatically once reconnected) and lands
// the trip as "pending" for the admin to approve, rather than adding it already-approved.
const DriverSubmitTrip = () => {
  const theme = useTheme();
  const { customers, vehicles, submitDriverTrip, user } = useAppContext();
  const assignedVehicle = vehicles.find(v => v.assignedDriverId === user?.id);
  const [pickedExisting, setPickedExisting] = useState<Customer | null>(null);
  const [draftCustomer, setDraftCustomer] = useState<DraftCustomer | null>(null);
  const selectedCustomer = pickedExisting || draftCustomer;

  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUSTOMER);
  const [newCustomerError, setNewCustomerError] = useState('');

  const [tripFields, setTripFields] = useState(() => defaultTripFields(assignedVehicle?.vehicleNumber || ''));
  const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const updateField = (name: keyof ReturnType<typeof defaultTripFields>, value: string) =>
    setTripFields(prev => ({ ...prev, [name]: value }));

  const handleCreateCustomer = () => {
    const name = newCustomer.name.trim();
    if (!name) {
      setNewCustomerError('Name is required');
      return;
    }
    setPickedExisting(null);
    setDraftCustomer({ name, phone: newCustomer.phone.trim(), address: newCustomer.address.trim() });
    setIsNewCustomerOpen(false);
    setNewCustomer(EMPTY_NEW_CUSTOMER);
    setNewCustomerError('');
  };

  const handleSubmit = async () => {
    if (!selectedCustomer) return;
    setMessage(null);
    if (tripFields.date.getTime() > Date.now()) {
      setMessage({ type: 'error', text: 'Trip date cannot be in the future.' });
      return;
    }
    setLoading(true);
    try {
      const result = await submitDriverTrip({
        customerId: pickedExisting?.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        customerAddress: selectedCustomer.address,
        date: tripFields.date.toISOString(),
        pickupLocation: tripFields.pickupLocation.trim(),
        dropLocation: tripFields.dropLocation.trim(),
        vehicleType: tripFields.vehicleType.trim(),
        vehicleNumber: tripFields.vehicleNumber.trim(),
        materialType: tripFields.materialType.trim(),
        amount: Number(tripFields.amount) || 0,
        advanceAmount: Number(tripFields.advanceAmount || 0),
        isPaid: tripFields.isPaid,
      });
      setPickedExisting(null);
      setDraftCustomer(null);
      setTripFields(defaultTripFields(assignedVehicle?.vehicleNumber || ''));
      setMessage(
        result.queued
          ? { type: 'warning', text: "No connection right now — saved on your phone and will send automatically once you're back online." }
          : { type: 'success', text: 'Trip submitted. Admin will review it now.' }
      );
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not submit trip' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: 'text.primary' }}>
          Submit Trip
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Pick a customer, then fill in the trip details. This reaches the admin dashboard immediately after submission.
        </Typography>
      </Box>

      {message && <Alert severity={message.type}>{message.text}</Alert>}

      <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Autocomplete
            options={customers}
            getOptionLabel={(option: Customer) => `${option.name}${option.phone ? ` — ${option.phone}` : ''}`}
            value={pickedExisting}
            onChange={(_, value) => { setPickedExisting(value); setDraftCustomer(null); }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            sx={{ flex: 1, minWidth: 240 }}
            renderInput={params => <TextField {...params} label="Customer" placeholder="Search customers..." />}
          />
          <Button
            variant="outlined"
            startIcon={<PersonAdd />}
            onClick={() => setIsNewCustomerOpen(true)}
            sx={{ height: 56, fontWeight: 700 }}
          >
            New Customer
          </Button>
        </Box>
        {draftCustomer && (
          <Typography variant="body2" sx={{ color: '#F0B90B', mt: 1.5, fontWeight: 600 }}>
            New customer: {draftCustomer.name}{draftCustomer.phone ? ` — ${draftCustomer.phone}` : ''}
          </Typography>
        )}
      </Paper>

      {selectedCustomer ? (
        <Paper elevation={0} sx={{ p: { xs: 2, sm: 4 }, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, mb: 2, color: 'text.primary' }}>
            Add New Trip for <span style={{ color: '#F0B90B' }}>{selectedCustomer.name}</span>
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DatePicker
                  label="Trip Date"
                  value={tripFields.date}
                  maxDate={new Date()}
                  onChange={value => setTripFields(prev => ({ ...prev, date: (value as Date | null) || new Date() }))}
                  slotProps={{ textField: { fullWidth: true, helperText: 'Future dates are not allowed' } }}
                />
              </LocalizationProvider>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={vehicles.map(v => v.vehicleNumber)}
                inputValue={tripFields.vehicleNumber}
                onInputChange={(_e, value) => updateField('vehicleNumber', value.toUpperCase())}
                renderInput={params => (
                  <TextField {...params} fullWidth label="Vehicle Number" placeholder="e.g. MH12AB1234" />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Pickup Location"
                value={tripFields.pickupLocation}
                onChange={e => updateField('pickupLocation', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Drop Location"
                value={tripFields.dropLocation}
                onChange={e => updateField('dropLocation', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Material Type (Optional)"
                value={tripFields.materialType}
                onChange={e => updateField('materialType', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Amount"
                type="number"
                value={tripFields.amount}
                onChange={e => updateField('amount', e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                placeholder="Enter amount"
                autoFocus
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Advance Amount"
                type="number"
                value={tripFields.advanceAmount}
                onChange={e => updateField('advanceAmount', e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                placeholder="Enter advance"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={tripFields.isPaid}
                      onChange={e => setTripFields(prev => ({ ...prev, isPaid: e.target.checked }))}
                      sx={{
                        color: 'text.secondary',
                        '&.Mui-checked': { color: '#0ECB81' },
                      }}
                    />
                  }
                  label={<Typography sx={{ fontWeight: 600, color: tripFields.isPaid ? '#0ECB81' : 'text.secondary' }}>Payment Received</Typography>}
                />
              </Box>
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                  variant="contained"
                  startIcon={<Send />}
                  onClick={handleSubmit}
                  disabled={loading}
                  sx={{ color: 'primary.contrastText', fontWeight: 800 }}
                >
                  {loading ? 'Submitting...' : 'Submit Trip'}
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      ) : (
        <Paper elevation={0} sx={{ p: 4, borderRadius: 2, background: 'background.paper', border: `1px dashed ${theme.palette.divider}`, textAlign: 'center' }}>
          <Typography sx={{ color: 'text.secondary' }}>Select or create a customer above to add a trip for them.</Typography>
        </Paper>
      )}

      {/* Create New Customer Dialog */}
      <Dialog open={isNewCustomerOpen} onClose={() => setIsNewCustomerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Customer</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {newCustomerError && <Alert severity="error">{newCustomerError}</Alert>}
            <TextField
              autoFocus
              label="Customer Name"
              value={newCustomer.name}
              onChange={e => setNewCustomer(prev => ({ ...prev, name: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Phone Number"
              value={newCustomer.phone}
              onChange={e => setNewCustomer(prev => ({ ...prev, phone: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Address (Optional)"
              value={newCustomer.address}
              onChange={e => setNewCustomer(prev => ({ ...prev, address: e.target.value }))}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsNewCustomerOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCustomer} variant="contained" sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            Create &amp; Select
          </Button>
        </DialogActions>
      </Dialog>

      <LoadingOverlay open={loading} label="Submitting trip…" />
    </Box>
  );
};

export default DriverSubmitTrip;
