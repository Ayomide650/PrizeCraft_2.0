const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Check if user is bot admin
function isAdmin(userId) {
    const adminIds = process.env.BOT_ADMIN_IDS?.split(',') || [];
    return adminIds.includes(userId);
}

// Parse time string to Nigeria time (GMT+1)
function parseTimeToNigeria(timeStr) {
    const now = new Date();
    const today = new Date(now.getTime() + (1 * 60 * 60 * 1000)); // Convert to GMT+1
    
    const timeRegex = /^(\d{1,2}):(\d{2})(AM|PM)$/i;
    const match = timeStr.match(timeRegex);
    
    if (!match) {
        throw new Error('Invalid time format. Use HH:MMAM or HH:MMPM (e.g., 9:00AM, 11:30PM)');
    }
    
    let [, hours, minutes, period] = match;
    hours = parseInt(hours);
    minutes = parseInt(minutes);
    
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
        throw new Error('Invalid time. Hours must be 1-12, minutes 0-59');
    }
    
    // Convert to 24-hour format
    if (period.toUpperCase() === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
    }
    
    const targetTime = new Date(today);
    targetTime.setHours(hours, minutes, 0, 0);
    
    // If the time has already passed today, set it for tomorrow
    const nowNigeria = new Date(now.getTime() + (1 * 60 * 60 * 1000));
    if (targetTime <= nowNigeria) {
        targetTime.setDate(targetTime.getDate() + 1);
    }
    
    return targetTime;
}

// Format time for display in Nigeria timezone
function formatNigeriaTime(date) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date);
}

// Create giveaway embed
function createGiveawayEmbed(item, endTime, winnersCount, participantCount = 0, giveawayId = null) {
    const embed = new EmbedBuilder()
        .setTitle(`🎁 ${item.name}`)
        .setDescription(item.description || 'No description provided')
        .setColor(0x00AE86)
        .addFields(
            { name: '⏰ Ends at', value: formatNigeriaTime(endTime), inline: true },
            { name: '🏆 Winners', value: winnersCount.toString(), inline: true },
            { name: '👥 Participants', value: participantCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: giveawayId ? `Giveaway ID: ${giveawayId}` : 'Loading...' });
    
    if (item.image_url) {
        embed.setImage(item.image_url);
    }
    
    return embed;
}

// Create giveaway button
function createGiveawayButton(participantCount = 0, disabled = false) {
    const button = new ButtonBuilder()
        .setCustomId('participate_giveaway')
        .setLabel(`🎁 Participate (${participantCount})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled);
    
    return new ActionRowBuilder().addComponents(button);
}

// Create ended giveaway embed
function createEndedGiveawayEmbed(item, winners, participantCount, giveawayId) {
    const embed = new EmbedBuilder()
        .setTitle(`🎁 ${item.name} - ENDED`)
        .setDescription(item.description || 'No description provided')
        .setColor(0xFF0000)
        .addFields(
            { name: '🏆 Winners', value: winners.length > 0 ? winners.map(w => `<@${w}>`).join('\n') : 'No winners selected', inline: false },
            { name: '👥 Total Participants', value: participantCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `Giveaway ID: ${giveawayId}` });
    
    if (item.image_url) {
        embed.setImage(item.image_url);
    }
    
    return embed;
}

// Create cancelled giveaway embed
function createCancelledGiveawayEmbed(item, participantCount, giveawayId) {
    const embed = new EmbedBuilder()
        .setTitle(`🎁 ${item.name} - CANCELLED`)
        .setDescription(item.description || 'No description provided')
        .setColor(0x808080)
        .addFields(
            { name: '❌ Status', value: 'This giveaway has been cancelled by an administrator', inline: false },
            { name: '👥 Participants', value: participantCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `Giveaway ID: ${giveawayId}` });
    
    if (item.image_url) {
        embed.setImage(item.image_url);
    }
    
    return embed;
}

// Select random winners
function selectRandomWinners(participants, winnersCount) {
    if (participants.length === 0) return [];
    if (participants.length <= winnersCount) return participants;
    
    const shuffled = [...participants].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, winnersCount);
}

module.exports = {
    isAdmin,
    parseTimeToNigeria,
    formatNigeriaTime,
    createGiveawayEmbed,
    createGiveawayButton,
    createEndedGiveawayEmbed,
    createCancelledGiveawayEmbed,
    selectRandomWinners
};
