import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle, Upload, AlertCircle } from 'lucide-react-native';
import { Colors } from '../../constants/theme';
import { useDriverStore } from '../../store/driver.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

type DocStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

interface DocItem {
  key: 'drivers_license' | 'insurance' | 'registration';
  label: string;
  description: string;
  status: DocStatus;
}

export default function DocumentUploadScreen({ navigation }: Props) {
  const { accessToken } = useDriverStore();

  const [docs, setDocs] = useState<DocItem[]>([
    {
      key: 'drivers_license',
      label: "Driver's License",
      description: 'Front and back of your valid state-issued license',
      status: 'pending',
    },
    {
      key: 'insurance',
      label: 'Auto Insurance',
      description: 'Current proof of insurance showing your name and vehicle',
      status: 'pending',
    },
    {
      key: 'registration',
      label: 'Vehicle Registration',
      description: 'Current registration for the vehicle you will drive',
      status: 'pending',
    },
  ]);

  const setDocStatus = (key: string, status: DocStatus) =>
    setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, status } : d)));

  const uploadDoc = async (docKey: DocItem['key']) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';

    setDocStatus(docKey, 'uploading');

    try {
      // 1. Get presigned upload URL
      const urlRes = await fetch(`${API_URL}/documents/upload-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ documentType: docKey, contentType }),
      });

      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await urlRes.json();

      // 2. Upload directly to S3
      const blob = await fetch(asset.uri).then((r) => r.blob());
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
      });

      if (!s3Res.ok) throw new Error('S3 upload failed');

      // 3. Confirm upload
      await fetch(`${API_URL}/documents/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ documentType: docKey }),
      });

      setDocStatus(docKey, 'uploaded');
    } catch (err) {
      setDocStatus(docKey, 'error');
      Alert.alert('Upload Failed', 'Please try again.');
    }
  };

  const allUploaded = docs.every((d) => d.status === 'uploaded');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.step}>Step 2 of 6</Text>
        <Text style={styles.title}>Upload Documents</Text>
        <Text style={styles.subtitle}>
          All documents are securely stored and encrypted. They are only reviewed by BidRide staff.
        </Text>
      </View>

      <View style={styles.docList}>
        {docs.map((doc) => (
          <TouchableOpacity
            key={doc.key}
            style={[
              styles.docCard,
              doc.status === 'uploaded' && styles.docCardDone,
              doc.status === 'error' && styles.docCardError,
            ]}
            onPress={() => uploadDoc(doc.key)}
            disabled={doc.status === 'uploading'}
          >
            <View style={styles.docInfo}>
              <Text style={styles.docLabel}>{doc.label}</Text>
              <Text style={styles.docDescription}>{doc.description}</Text>
            </View>

            <View style={styles.docStatus}>
              {doc.status === 'pending' && <Upload size={20} color={Colors.textTertiary} />}
              {doc.status === 'uploading' && <ActivityIndicator color={Colors.teal} size="small" />}
              {doc.status === 'uploaded' && <CheckCircle size={20} color={Colors.teal} />}
              {doc.status === 'error' && <AlertCircle size={20} color={Colors.safety} />}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !allUploaded && styles.continueBtnDisabled]}
          onPress={() => navigation.navigate('BackgroundCheck')}
          disabled={!allUploaded}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, marginBottom: 32 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  docList: { flex: 1, paddingHorizontal: 24, gap: 12 },
  docCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  docCardDone: { borderColor: Colors.teal },
  docCardError: { borderColor: Colors.safety },
  docInfo: { flex: 1 },
  docLabel: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  docDescription: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  docStatus: { width: 24, alignItems: 'center' },
  footer: { padding: 24, paddingBottom: 32 },
  continueBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
