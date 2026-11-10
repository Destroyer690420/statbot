import { discordChannelUrl } from '../content/workerGuide';

interface TicketLinkProps {
  /** Guild the ticket lives in (from the task API's `guildId`). */
  guildId?: string | null;
  /** Discord channel ID of the ticket. */
  channelId?: string | null;
  /** Channel name, shown as `#name` when present. */
  channelName?: string | null;
  /** Classes applied to both the link and the plain-text fallback. */
  className?: string;
}

/**
 * Renders a ticket label (`#ticket-name`, falling back to the channel ID) that
 * opens the ticket in Discord when both guild and channel IDs are known.
 *
 * Errors cannot be validated per row without a Discord API round-trip, so any
 * existing `channelId` gets a link; a deleted channel lands on Discord's
 * "unknown channel" screen. When IDs are missing the label stays plain text.
 */
export function TicketLink({ guildId, channelId, channelName, className = '' }: TicketLinkProps) {
  const label = channelName ? `#${channelName}` : channelId || '';

  if (!guildId || !channelId) {
    return <span className={className}>{label}</span>;
  }

  return (
    <a
      href={discordChannelUrl(guildId, channelId)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${channelName ? `#${channelName}` : channelId} in Discord`}
      className={`${className} hover:text-primary-400 hover:underline underline-offset-2 transition-colors`}
    >
      {label}
    </a>
  );
}
