/**
 * The "add this ticket to the daily outreach" button that rides on the
 * in-ticket profile-passed notice.
 *
 * Two things are easy to get wrong and expensive here, so they are pinned:
 *
 *  1. The custom id encodes the ticket. If it round-trips lossily, a click
 *     selects the WRONG ticket — a real worker's ticket enters the daily
 *     outreach blast because of a parsing bug.
 *  2. The id must be namespaced. `interactionCreate` routes on the prefix, so
 *     a collision would route a click into the blast handler.
 */

import {
  OUTREACH_ADD_BUTTON_PREFIX,
  OUTREACH_ADD_LABEL,
  OUTREACH_ADDED_LABEL,
  buildOutreachAddButton,
  parseOutreachAddId,
} from '../utils/outreach-add-button';

describe('parseOutreachAddId', () => {
  it('round-trips a snowflake channel id', () => {
    const channelId = '1234567890123456789';
    expect(parseOutreachAddId(`${OUTREACH_ADD_BUTTON_PREFIX}${channelId}`)).toBe(channelId);
  });

  it('rejects an id with no channel, which must never select ticket "undefined"', () => {
    expect(parseOutreachAddId(OUTREACH_ADD_BUTTON_PREFIX)).toBeNull();
  });

  it('rejects another flow\'s button id', () => {
    // A blast id reaching this parser means the two namespaces collide.
    expect(parseOutreachAddId('blast:go:2026-10-01 13:00')).toBeNull();
    expect(parseOutreachAddId('outreach_add:abc:def')).toBeNull();
    expect(parseOutreachAddId('')).toBeNull();
    expect(parseOutreachAddId('nonsense')).toBeNull();
  });

  it('keeps the blast prefix distinct so routing cannot cross over', () => {
    expect(OUTREACH_ADD_BUTTON_PREFIX).not.toBe('blast:');
    expect(OUTREACH_ADD_BUTTON_PREFIX.startsWith('blast')).toBe(false);
  });
});

describe('buildOutreachAddButton', () => {
  function firstButton(components: ReturnType<typeof buildOutreachAddButton>) {
    const row = components[0];
    expect(row).toBeDefined();
    return row!.toJSON().components[0] as {
      type: number;
      custom_id: string;
      label: string;
      style: number;
      disabled?: boolean;
    };
  }

  it('carries the ticket in its custom id so one click cannot select another', () => {
    const button = firstButton(buildOutreachAddButton('1234567890123456789'));
    expect(button.custom_id).toBe(`${OUTREACH_ADD_BUTTON_PREFIX}1234567890123456789`);
  });

  it('offers exactly one button, labelled with the action', () => {
    const button = firstButton(buildOutreachAddButton('1234567890123456789'));
    expect(button.label).toBe(OUTREACH_ADD_LABEL);
    expect(button.type).toBe(2); // Button
    expect(button.disabled).toBeFalsy();
  });

  it('can be rendered already-applied so the ticket cannot be added twice', () => {
    const button = firstButton(buildOutreachAddButton('1234567890123456789', { added: true }));
    expect(button.disabled).toBe(true);
    expect(button.label).toBe(OUTREACH_ADDED_LABEL);
  });

  it('builds a valid action row with no more than one button', () => {
    const components = buildOutreachAddButton('1234567890123456789');
    expect(components).toHaveLength(1);
    expect(components[0].toJSON().components).toHaveLength(1);
  });
});