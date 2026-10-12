import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GridLegacy as Grid,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { CheckCircle, Close, Edit, HourglassTop, RateReview, Block } from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import LoadingOverlay from '../components/LoadingOverlay';
import type { Trip } from '../types';

type EditableKey =
  | 'customerName'
  | 'customerPhone'
  | 'customerAddress'
  | 'date'
  | 'pickupLocation'
  | 'dropLocation'
  | 'vehicleType'
  | 'vehicleNumber'
  | 'materialType'
  | 'amount'
  | 'advanceAmount';

const AdminTripApprovals = () => {
  const theme = useTheme();
  const { pendingTrips, allTrips, approveTrip, rejectTrip, updateTrip, tripEditRequests, resolveTripEditRequest } = useAppContext();
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  // Set when the edit dialog was opened from a driver's update request rather than from the
  // pending-approvals list — saving successfully then also resolves that request.
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [rejectingTrip, setRejectingTrip] = useState<Trip | null>(null);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<EditableKey, string>>({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    date: '',
    pickupLocation: '',
    dropLocation: '',
    vehicleType: '',
    vehicleNumber: '',
    materialType: '',
    amount: '',
    advanceAmount: '',
  });
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Tracks the in-flight approve/reject request so the UI can show a clear "something is
  // happening" overlay instead of a still page that looks like the click didn't register.
  const [processing, setProcessing] = useState<{ tripId: string; action: 'approve' | 'reject' } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (trip: Trip, requestId: string | null = null) => {
    setEditingTrip(trip);
    setEditingRequestId(requestId);
    setEditForm({
      customerName: trip.customerName || '',
      customerPhone: trip.customerPhone || '',
      customerAddress: trip.customerAddress || '',
      date: trip.date ? trip.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      pickupLocation: trip.pickupLocation || '',
      dropLocation: trip.dropLocation || '',
      vehicleType: trip.vehicleType || '',
      vehicleNumber: trip.vehicleNumber || '',
      materialType: trip.materialType || '',
      amount: String(trip.amount || ''),
      advanceAmount: String(trip.advanceAmount || ''),
    });
  };

  const saveEdit = async () => {
    if (!editingTrip) return;
    setSavingEdit(true);
    try {
      await updateTrip(editingTrip.id, {
        ...editForm,
        date: new Date(editForm.date).toISOString(),
        amount: Number(editForm.amount),
        advanceAmount: Number(editForm.advanceAmount || 0),
      });
      if (editingRequestId) {
        await resolveTripEditRequest(editingRequestId, 'resolved');
      }
      setEditingTrip(null);
      setEditingRequestId(null);
      setMessage({ type: 'success', text: 'Trip updated.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not update trip' });
    } finally {
      setSavingEdit(false);
    }
  };

  const dismissRequest = async (requestId: string) => {
    setResolvingRequestId(requestId);
    try {
      await resolveTripEditRequest(requestId, 'dismissed');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not dismiss the request' });
    } finally {
      setResolvingRequestId(null);
    }
  };

  const approve = async (tripId: string) => {
    setProcessing({ tripId, action: 'approve' });
    try {
      await approveTrip(tripId);
      setMessage({ type: 'success', text: 'Trip approved and added to billing.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not approve trip' });
    } finally {
      setProcessing(null);
    }
  };

  const reject = async () => {
    if (!rejectingTrip) return;
    setProcessing({ tripId: rejectingTrip.id, action: 'reject' });
    try {
      await rejectTrip(rejectingTrip.id, rejectReason || 'Rejected by admin');
      setRejectingTrip(null);
      setRejectReason('');
      setMessage({ type: 'success', text: 'Trip rejected. Driver can see the update.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not reject trip' });
    } finally {
      setProcessing(null);
    }
  };

  // Pending driver update-requests, joined with their (already-approved) trip — a request whose
  // trip has since vanished (shouldn't normally happen) is skipped rather than shown broken.
  const pendingEditRequests = tripEditRequests
    .filter(r => r.status === 'pending')
    .map(request => ({ request, trip: allTrips.find(t => t.id === request.tripId) }))
    .filter((entry): entry is { request: typeof tripEditRequests[number]; trip: Trip } => Boolean(entry.trip));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h5" sx={{ color: '#F0B90B', fontWeight: 800 }}>
              Pending Trip Approvals
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              New driver submissions appear here in real time.
            </Typography>
          </Box>
          <Chip
            icon={<HourglassTop />}
            label={`${pendingTrips.length} pending`}
            sx={{ bgcolor: 'rgba(240,185,11,0.12)', color: '#F0B90B', fontWeight: 800 }}
          />
        </Box>
      </Paper>

      {message && <Alert severity={message.type}>{message.text}</Alert>}

      {pendingTrips.length === 0 ? (
        <Paper elevation={0} sx={{ p: 5, bgcolor: 'background.paper', border: `1px dashed ${theme.palette.divider}`, textAlign: 'center' }}>
          <Typography sx={{ color: 'text.secondary' }}>No pending trips right now.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {pendingTrips.map(trip => {
            const isThisProcessing = processing?.tripId === trip.id;
            const isApproving = isThisProcessing && processing?.action === 'approve';
            return (
              <Paper
                key={trip.id}
                elevation={0}
                sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`, position: 'relative', overflow: 'hidden' }}
              >
                <LoadingOverlay
                  open={isThisProcessing}
                  absolute
                  label={processing?.action === 'reject' ? 'Rejecting trip…' : 'Approving trip…'}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box>
                    <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 800 }}>
                      {trip.customerName || 'Customer'} - ₹{Number(trip.amount || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Driver: {trip.driverName || 'Unknown'} | {new Date(trip.date).toLocaleDateString('en-IN')}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                      {trip.pickupLocation} to {trip.dropLocation}
                      {(trip.vehicleType || trip.vehicleNumber) ? ` | Vehicle: ${trip.vehicleType || ''}${trip.vehicleNumber ? ` (${trip.vehicleNumber})` : ''}` : ''}
                    </Typography>
                    {trip.materialType && (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Material: {trip.materialType}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Button variant="outlined" startIcon={<Edit />} onClick={() => openEdit(trip)} disabled={isThisProcessing}>
                      Edit
                    </Button>
                    <Button variant="outlined" color="error" startIcon={<Close />} onClick={() => setRejectingTrip(trip)} disabled={isThisProcessing}>
                      Reject
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={isApproving ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : <CheckCircle />}
                      onClick={() => approve(trip.id)}
                      disabled={isThisProcessing}
                      sx={{ color: 'primary.contrastText', fontWeight: 800 }}
                    >
                      {isApproving ? 'Approving…' : 'Approve'}
                    </Button>
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Stack>
      )}

      {pendingEditRequests.length > 0 && (
        <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Box>
              <Typography variant="h5" sx={{ color: '#F0B90B', fontWeight: 800 }}>
                Trip Update Requests
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Drivers asking for a change to a trip that's already approved.
              </Typography>
            </Box>
            <Chip
              icon={<RateReview />}
              label={`${pendingEditRequests.length} pending`}
              sx={{ bgcolor: 'rgba(240,185,11,0.12)', color: '#F0B90B', fontWeight: 800 }}
            />
          </Box>
          <Stack spacing={2}>
            {pendingEditRequests.map(({ request, trip }) => {
              const isResolving = resolvingRequestId === request.id;
              return (
                <Box
                  key={request.id}
                  sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', border: `1px solid ${theme.palette.divider}` }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                    <Box>
                      <Typography sx={{ color: 'text.primary', fontWeight: 700 }}>
                        {trip.customerName || 'Customer'} — ₹{Number(trip.amount || 0).toFixed(2)}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Driver: {request.driverName || 'Unknown'} | {new Date(trip.date).toLocaleDateString('en-IN')} | {trip.pickupLocation} to {trip.dropLocation}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#F0B90B', mt: 1, fontWeight: 600 }}>
                        "{request.message}"
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<Block />}
                        onClick={() => dismissRequest(request.id)}
                        disabled={isResolving}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<Edit />}
                        onClick={() => openEdit(trip, request.id)}
                        disabled={isResolving}
                        sx={{ color: 'primary.contrastText', fontWeight: 700 }}
                      >
                        Edit Trip
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      <Dialog
        open={Boolean(editingTrip)}
        onClose={() => { setEditingTrip(null); setEditingRequestId(null); }}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { position: 'relative', overflow: 'hidden' } }}
      >
        <LoadingOverlay open={savingEdit} absolute label="Saving trip…" />
        <DialogTitle>{editingRequestId ? 'Edit Trip' : 'Edit Trip Before Approval'}</DialogTitle>
        <DialogContent>
          {editingRequestId && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Driver's request: "{tripEditRequests.find(r => r.id === editingRequestId)?.message}"
            </Alert>
          )}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField label="Customer Name" value={editForm.customerName} onChange={event => setEditForm(prev => ({ ...prev, customerName: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Customer Phone" value={editForm.customerPhone} onChange={event => setEditForm(prev => ({ ...prev, customerPhone: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Customer Address" value={editForm.customerAddress} onChange={event => setEditForm(prev => ({ ...prev, customerAddress: event.target.value }))} fullWidth multiline rows={2} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Trip Date" type="date" value={editForm.date} onChange={event => setEditForm(prev => ({ ...prev, date: event.target.value }))} fullWidth InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Vehicle Type (Optional)" value={editForm.vehicleType} onChange={event => setEditForm(prev => ({ ...prev, vehicleType: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Vehicle Number" value={editForm.vehicleNumber} onChange={event => setEditForm(prev => ({ ...prev, vehicleNumber: event.target.value.toUpperCase() }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Pickup Location" value={editForm.pickupLocation} onChange={event => setEditForm(prev => ({ ...prev, pickupLocation: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Drop Location" value={editForm.dropLocation} onChange={event => setEditForm(prev => ({ ...prev, dropLocation: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Material Type" value={editForm.materialType} onChange={event => setEditForm(prev => ({ ...prev, materialType: event.target.value }))} fullWidth />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Amount" type="number" value={editForm.amount} onChange={event => setEditForm(prev => ({ ...prev, amount: event.target.value }))} fullWidth InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Advance" type="number" value={editForm.advanceAmount} onChange={event => setEditForm(prev => ({ ...prev, advanceAmount: event.target.value }))} fullWidth InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditingTrip(null); setEditingRequestId(null); }} disabled={savingEdit}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveEdit}
            disabled={savingEdit}
            startIcon={savingEdit ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : undefined}
            sx={{ color: 'primary.contrastText', fontWeight: 800, minWidth: 148 }}
          >
            {savingEdit ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(rejectingTrip)}
        onClose={() => setRejectingTrip(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { position: 'relative', overflow: 'hidden' } }}
      >
        <LoadingOverlay open={processing?.action === 'reject'} absolute label="Rejecting trip…" />
        <DialogTitle>Reject Trip</DialogTitle>
        <DialogContent>
          <TextField
            label="Reason"
            value={rejectReason}
            onChange={event => setRejectReason(event.target.value)}
            fullWidth
            multiline
            rows={3}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectingTrip(null)} disabled={Boolean(processing)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={reject}
            disabled={Boolean(processing)}
            startIcon={processing?.action === 'reject' ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : undefined}
          >
            {processing?.action === 'reject' ? 'Rejecting…' : 'Reject Trip'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminTripApprovals;
