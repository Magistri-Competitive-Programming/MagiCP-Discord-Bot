import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown
} from 'discord.js'

export const profiles = {
  student: 'Studente',
  competitor: 'Studente in gara',
  alumnus: 'Ex studente',
  external: 'Esterno'
}

export const statusLabels = {
  pending: 'In attesa',
  processing: 'In elaborazione',
  accepted: 'Accettata',
  external: 'Accettata come esterno',
  rejected: 'Rifiutata'
}

const accent = 0xfa785f
export const noMentions = { parse: [] }
const button = (id, text, style) => new ButtonBuilder().setCustomId(id).setLabel(text).setStyle(style)

export function verificationPost() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(accent)
      .setTitle('Verifica MagiCP')
      .setDescription('Non sei ancora stato verificato? Richiedi la verifica ora.')],
    components: [new ActionRowBuilder().addComponents(button('verify:start', 'Verifica', ButtonStyle.Primary))],
    allowedMentions: noMentions
  }
}

export function profileSelection() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('verify:profile')
    .setPlaceholder('Scegli il tuo profilo')
    .addOptions(Object.entries(profiles).map(([value, label]) => ({ label, value })))
  return new ActionRowBuilder().addComponents(select)
}

export const requiresClass = profile => profile === 'student' || profile === 'competitor'

function textField(id, label, style, maxLength, required, placeholder) {
  return new LabelBuilder().setLabel(label).setTextInputComponent(
    new TextInputBuilder()
      .setCustomId(id).setStyle(style).setMaxLength(maxLength).setRequired(required).setPlaceholder(placeholder)
  )
}

export function applicationModal(profile) {
  const modal = new ModalBuilder().setCustomId(`verify:apply:${profile}`).setTitle('Richiesta di verifica')
  modal.addLabelComponents(
    textField('name', 'Nome e cognome', TextInputStyle.Short, 100, true, 'Mario Rossi')
  )
  if (requiresClass(profile)) {
    modal.addLabelComponents(textField('class', 'Classe', TextInputStyle.Short, 24, true, '3B'))
  }
  return modal.addLabelComponents(
    textField('competitions', 'Competizioni a cui hai partecipato', TextInputStyle.Paragraph, 850, false, 'Una competizione per riga'),
    textField('awards', 'Medaglie o altri riconoscimenti', TextInputStyle.Paragraph, 500, false, 'Es. bronzo alle OII')
  )
}

export function roleModal(id, roles) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('roles').setPlaceholder('Seleziona uno o più ruoli')
    .setMinValues(1).setMaxValues(roles.length)
    .addOptions(roles.map(({ name, id }) => ({ label: name, value: id })))
  return new ModalBuilder().setCustomId(`review:roles:${id}`).setTitle('Accetta e assegna i ruoli')
    .addLabelComponents(new LabelBuilder().setLabel('Ruoli da assegnare').setStringSelectMenuComponent(select))
}

export function reviewPost(request) {
  const clean = value => value ? escapeMarkdown(value).replaceAll('@', '@\u200b').slice(0, 1000) : '—'
  const embed = new EmbedBuilder()
    .setColor(request.status === 'rejected' ? 0x8c8684 : accent)
    .setTitle('Richiesta di verifica')
    .setDescription(`Account Discord · <@${request.user_id}>`)
    .addFields(
      { name: 'Nome e cognome', value: clean(request.name), inline: true },
      { name: 'Profilo', value: profiles[request.profile], inline: true },
      { name: 'Classe', value: clean(request.school_class), inline: true },
      { name: 'Competizioni', value: clean(request.competitions) },
      { name: 'Medaglie e riconoscimenti', value: clean(request.awards) }
    )
    .setFooter({ text: statusLabels[request.status] })
    .setTimestamp(request.created_at)
  if (request.reviewer && request.status !== 'processing') {
    const roles = JSON.parse(request.role_ids)
    embed.addFields({ name: 'Decisione', value: [
      `${statusLabels[request.status]} da <@${request.reviewer}>`,
      roles.length && roles.map(id => `<@&${id}>`).join(', ')
    ].filter(Boolean).join('\n') })
  }
  const actions = new ActionRowBuilder().addComponents(
    button(`review:accept:${request.id}`, 'Accetta', ButtonStyle.Success),
    button(`review:reject:${request.id}`, 'Rifiuta', ButtonStyle.Danger),
    button(`review:external:${request.id}`, 'Accetta come esterno', ButtonStyle.Secondary)
  )
  return {
    embeds: [embed],
    components: request.status === 'pending' ? [actions] : [],
    allowedMentions: noMentions
  }
}
