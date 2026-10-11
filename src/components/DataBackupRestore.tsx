import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Alert, CircularProgress,
} from '@mui/material';
import { useAppContext } from '../context/AppContext';
import { saveToFile, loadFromFile } from '../utils/tauri-api';

interface DataBackupRestoreProps {
  open: boolean;
  onClose: () => void;
  mode: 'backup' | 'restore';
}

const DataBackupRestore: React.FC<DataBackupRestoreProps> = ({ open, onClose, mode }) => {
  const { customers, trips, restoreBackup } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  const handleBackup = async () => {
    setLoading(true);
    setResult(null);
    try {
      const backupData = {
        customers,
        trips,
        backupDate: new Date().toISOString(),
        appVersion: '1.0.0',
      };
      const fileName = `transport_manager_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const saved = await saveToFile(JSON.stringify(backupData, null, 2), fileName);
      setResult(saved
        ? { success: true, message: `Backup downloaded as: ${saved}` }
        : { success: false, message: 'Backup cancelled.' }
      );
    } catch (error) {
      setResult({ success: false, message: `Backup failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    setResult(null);
    try {
      const fileContent = await loadFromFile();
      if (!fileContent) {
        setResult({ success: false, message: 'Restore cancelled.' });
        return;
      }
      const parsed = JSON.parse(fileContent);
      if (!Array.isArray(parsed.customers) || !Array.isArray(parsed.trips)) {
        throw new Error('Invalid backup file format');
      }
      const { customersImported, tripsImported } = await restoreBackup(parsed.customers, parsed.trips);
      setResult({
        success: true,
        message: `Imported ${customersImported} customer${customersImported === 1 ? '' : 's'} and ${tripsImported} trip${tripsImported === 1 ? '' : 's'}. Existing data was left untouched.`,
      });
    } catch (error) {
      setResult({ success: false, message: `Restore failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === 'backup' ? 'Backup Data' : 'Restore Data'}</DialogTitle>
      <DialogContent>
        <Box sx={{ minHeight: 80 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 80 }}>
              <CircularProgress />
            </Box>
          ) : result ? (
            <Alert severity={result.success ? 'success' : 'error'} sx={{ mt: 1 }}>{result.message}</Alert>
          ) : (
            <Typography sx={{ mt: 1 }}>
              {mode === 'backup'
                ? 'Downloads all customer and trip data as a JSON file to your computer.'
                : "Upload a previously downloaded backup file — its customers and trips (even from a different account) are imported into this one. Your existing data isn't removed or overwritten."}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {!loading && !result?.success && (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button onClick={mode === 'backup' ? handleBackup : handleRestore} variant="contained" disabled={loading}>
              {mode === 'backup' ? 'Download Backup' : 'Upload & Restore'}
            </Button>
          </>
        )}
        {(loading || result?.success) && (
          <Button onClick={handleClose} disabled={loading}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default DataBackupRestore;
