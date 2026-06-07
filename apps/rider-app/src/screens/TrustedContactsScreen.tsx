import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus, Trash2, UserPlus } from 'lucide-react-native';
import { Colors } from '../constants/theme';
import { useAuthStore } from '../store/auth.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

interface TrustedContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
}

export default function TrustedContactsScreen({ navigation }: Props) {
  const { accessToken } = useAuthStore();
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: '', phone: '', relationship: '' });

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const res = await fetch(`${API_URL}/riders/me/trusted-contacts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      setContacts(data);
    } catch {
      Alert.alert('Error', 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  };

  const addContact = async () => {
    if (!form.name || !form.phone || !form.relationship) {
      Alert.alert('Required', 'Please fill in all fields.');
      return;
    }

    const e164 = form.phone.replace(/\D/g, '');
    if (e164.length !== 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid 10-digit US phone number.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/riders/me/trusted-contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ...form, phone: `+1${e164}` }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Failed to add contact');
      }

      await fetchContacts();
      setShowModal(false);
      setForm({ name: '', phone: '', relationship: '' });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeContact = (contactId: string, name: string) => {
    Alert.alert(
      'Remove Contact',
      `Remove ${name} from your trusted contacts? They will no longer be notified during an SOS.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_URL}/riders/me/trusted-contacts/${contactId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              setContacts((prev) => prev.filter((c) => c.id !== contactId));
            } catch {
              Alert.alert('Error', 'Could not remove contact.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trusted Contacts</Text>
        <Text style={styles.subtitle}>
          These contacts are notified automatically when you trigger an SOS.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.teal} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          style={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <UserPlus size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No contacts yet</Text>
              <Text style={styles.emptySubtitle}>
                Add up to 5 trusted contacts who will be notified in an emergency.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.contactCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name[0]}</Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactDetails}>
                  {item.relationship} · {item.phone}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeContact(item.id, item.name)}>
                <Trash2 size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {contacts.length < 5 && (
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Plus size={20} color={Colors.background} />
          <Text style={styles.addBtnText}>Add Contact</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Trusted Contact</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalForm}>
            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
                placeholder="Full name"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={form.phone}
                onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))}
                placeholder="(555) 555-5555"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Relationship</Text>
              <TextInput
                style={styles.input}
                value={form.relationship}
                onChangeText={(v) => setForm((p) => ({ ...p, relationship: v }))}
                placeholder="Spouse, Parent, Friend…"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={addContact}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.background} />
              ) : (
                <Text style={styles.saveBtnText}>Add Contact</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 24, paddingTop: 24, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  list: { flex: 1, paddingHorizontal: 24 },
  emptyState: { alignItems: 'center', paddingVertical: 64, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.teal + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: Colors.teal },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  contactDetails: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    margin: 24,
  },
  addBtnText: { fontSize: 16, fontWeight: '700', color: Colors.background },
  modal: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  cancelText: { fontSize: 15, color: Colors.teal },
  modalForm: { padding: 24, gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.background },
});
