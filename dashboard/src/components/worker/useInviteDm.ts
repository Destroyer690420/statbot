import { useState } from 'react';
import { getInviteeDmUrl, workerErrorMessage } from '../../api/workerApi';

/**
 * Click-to-DM for an invited person: opens a tab synchronously (browsers
 * block pop-ups opened after an await) and points it at the profile URL the
 * server resolves from the opaque ref. Shared by the inviter Home, the
 * Invites page and the Team view.
 */
export function useInviteDm() {
  const [dmFor, setDmFor] = useState<string | null>(null);
  const [dmError, setDmError] = useState('');

  const openDm = async (person: { name: string; dmRef: string }) => {
    if (!person.dmRef || dmFor) return;
    setDmFor(person.dmRef);
    setDmError('');
    const tab = window.open('', '_blank');
    try {
      const res = await getInviteeDmUrl(person.dmRef);
      if (res?.success && res.data?.profileUrl) {
        if (tab) {
          tab.opener = null;
          tab.location.href = res.data.profileUrl;
        } else {
          window.location.href = res.data.profileUrl;
        }
      } else {
        tab?.close();
        setDmError(workerErrorMessage(res, `Could not open a DM with ${person.name}.`));
      }
    } catch (err: unknown) {
      tab?.close();
      setDmError(workerErrorMessage(err, `Could not open a DM with ${person.name}.`));
    } finally {
      setDmFor(null);
    }
  };

  return { dmFor, dmError, openDm };
}
