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

export const noMentions = { parse: [] }
const button = (id, text, style) => new ButtonBuilder().setCustomId(id).setLabel(text).setStyle(style)

function brandedEmbed({ color, icon }) {
  const embed = new EmbedBuilder().setAuthor({ name: 'MagiCP · Verifiche', iconURL: icon ?? undefined })
  if (color) embed.setColor(color)
  return embed
}

export function verificationPost(appearance) {
  return {
    embeds: [brandedEmbed(appearance)
      .setTitle('Richiedi la verifica')
      .setDescription('Non sei ancora stato verificato? Richiedi la verifica ora e fatti assegnare i ruoli per il tuo profilo.')
      .addFields(
        { name: 'Compila il modulo', value: 'Premi **Verifica**, scegli il tuo profilo e inserisci i tuoi dati. Puoi indicare le gare a cui hai partecipato e i riconoscimenti ottenuti.' },
        { name: 'Attendi la revisione', value: 'La richiesta viene inviata al canale riservato allo staff. Dopo la valutazione, i ruoli approvati compaiono sul tuo profilo Discord nel server.' }
      )],
    components: [new ActionRowBuilder().addComponents(button('verify:start', 'Verifica', ButtonStyle.Primary))],
    allowedMentions: noMentions
  }
}

export const requiresClass = profile => profile === 'student' || profile === 'competitor'

function textField(id, label, style, maxLength, required, placeholder, description) {
  const field = new LabelBuilder().setLabel(label).setTextInputComponent(
    new TextInputBuilder()
      .setCustomId(id).setStyle(style).setMaxLength(maxLength).setRequired(required).setPlaceholder(placeholder)
  )
  if (description) field.setDescription(description)
  return field
}

export function applicationModal() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('profile').setPlaceholder('Scegli il profilo che ti descrive').setRequired(true)
    .addOptions(Object.entries(profiles).map(([value, label]) => ({ label, value })))
  return new ModalBuilder().setCustomId('verify:apply').setTitle('Verifica MagiCP')
    .addLabelComponents(
      new LabelBuilder().setLabel('Profilo').setStringSelectMenuComponent(select),
      textField('name', 'Nome e cognome', TextInputStyle.Short, 100, true, 'Mario Rossi'),
      textField('class', 'Classe', TextInputStyle.Short, 24, false, 'Es. 3B', 'Obbligatoria per Studente e Studente in gara.'),
      textField('competitions', 'Competizioni a cui hai partecipato', TextInputStyle.Paragraph, 850, false, 'Una competizione per riga, con l’anno se lo ricordi'),
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

export function reviewPost(request, appearance) {
  const clean = value => escapeMarkdown(value).replaceAll('@', '@\u200b').slice(0, 1000)
  const status = statusLabels[request.status]
  const embed = brandedEmbed(appearance)
    .setTitle('Richiesta di verifica')
    .setDescription(request.status === 'pending'
      ? 'Esamina i dati del candidato e scegli come procedere.'
      : `Esito della candidatura: **${status}**.`)
    .addFields(
      { name: 'Nome e cognome', value: clean(request.name), inline: true },
      { name: 'Profilo', value: profiles[request.profile], inline: true },
      { name: 'Account Discord', value: `<@${request.user_id}>`, inline: true },
      { name: 'Classe', value: clean(request.school_class) || 'Non indicata', inline: true },
      { name: 'Competizioni', value: clean(request.competitions) || 'Nessuna indicata' },
      { name: 'Medaglie e riconoscimenti', value: clean(request.awards) || 'Nessuno indicato' }
    )
    .setFooter({ text: `${status} · Richiesta ${request.id.slice(0, 8)}` })
    .setTimestamp(request.created_at)
  if (request.reviewer && request.status !== 'processing') {
    const roles = JSON.parse(request.role_ids)
    embed.addFields({ name: 'Decisione', value: [
      `Revisore: <@${request.reviewer}>`,
      roles.length && `Ruoli assegnati: ${roles.map(id => `<@&${id}>`).join(', ')}`
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
