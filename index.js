require('dotenv').config(); // For local development
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection } = require('discord.js');
const supabase = require('./supabaseClient.js');
const { zonedTimeToUtc, formatInTimeZone, utcToZonedTime } = require('date-fns-tz');

const NIGERIA_TIMEZONE = 'Africa/Lagos'; // GMT+1

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message], // Required for DMs
});

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFIX = process.env.BOT_PREFIX || '.';
const ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

if (!BOT_TOKEN || ADMIN_IDS.length === 0) {
    console.error("BOT_TOKEN or BOT_ADMIN_IDS are not set. Please check your environment variables.");
    process.exit(1);
}

// Helper function to check if a user is an admin
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Helper function to parse time (HH:MMAM/PM) for today in Nigeria time
function parseEndTime(timeString) {
    const match = timeString.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (period === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period === 'AM' && hours === 12) { // Midnight case: 12 AM is 00 hours
        hours = 0;
    }

    // Create date object for today in Nigeria timezone, then set the parsed time
    const nowInNigeria = new Date(); // This gets current system time, we need to interpret it as if it's Nigeria time for date part.
                                  // Then combine with parsed hours/minutes.
                                  // For safety, it's better to construct the date fully with date-fns-tz

    const year = nowInNigeria.getFullYear();
    const month = nowInNigeria.getMonth(); // 0-indexed
    const day = nowInNigeria.getDate();

    // Create a Date object representing the specified time in Nigeria time zone
    // Note: Date constructor month is 0-indexed.
    const localTimeInNigeria = new Date(year, month, day, hours, minutes, 0);

    // Check if the parsed time is in the past for today. If so, assume it's for tomorrow.
    // This logic might need adjustment based on how strictly "today" is interpreted.
    // For simplicity here, we'll assume valid times are for today, even if slightly in the past,
    // or the giveaway check will handle it.
    // A more robust solution would be to explicitly require a date if not today.
    // The spec says "today", so we proceed with that assumption.

    // Convert this Nigeria local time to UTC for storage
    return zonedTimeToUtc(localTimeInNigeria, NIGERIA_TIMEZONE);
}


client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Admin IDs: ${ADMIN_IDS.join(', ')}`);
    console.log(`Prefix: ${PREFIX}`);
    checkEndedGiveaways(); // Check once on startup
    setInterval(checkEndedGiveaways, 30000); // Check every 30 seconds
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isDM = message.channel.type === Partials.Channel; // Or use ChannelType.DM after v14.8.0
    if (isDM && !message.content.startsWith(PREFIX)) { // Allow DMs without prefix for conversation flow of additem
         // Handle .additem flow or other DM commands
    } else if (!isDM && !message.content.startsWith(PREFIX)){
        return;
    }


    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- ADMIN DM COMMANDS ---
    if (isDM) {
        if (!isAdmin(message.author.id)) {
            // Silently ignore or reply "You are not authorized for DM commands."
            // For this spec, we assume only admins will DM, but a check is good.
            // Let commands handle their own admin checks to provide specific feedback.
        }

        if (command === 'additem') {
            if (!isAdmin(message.author.id)) return message.reply("You are not authorized to use this command.");
            try {
                const questions = [
                    "What is the name of the item? (e.g., 'Free Nitro')",
                    "Please provide a short description for the item.",
                    "Please provide an image URL for the item (optional, type 'skip' if none).",
                ];
                let answers = [];
                let item = {};

                const filter = m => m.author.id === message.author.id;
                const collector = message.channel.createMessageCollector({ filter, time: 60000 * 5 }); // 5 minutes to answer

                let currentQuestion = 0;
                await message.channel.send(questions[currentQuestion]);

                collector.on('collect', async m => {
                    if (m.content.toLowerCase() === `${PREFIX}cancel`) { // Allow cancelling mid-process
                        collector.stop('cancelled');
                        return message.channel.send("Item addition cancelled.");
                    }
                    answers.push(m.content);
                    currentQuestion++;
                    if (currentQuestion < questions.length) {
                        await message.channel.send(questions[currentQuestion]);
                    } else {
                        collector.stop('completed');
                    }
                });

                collector.on('end', async (collected, reason) => {
                    if (reason === 'completed') {
                        item.name = answers[0];
                        item.description = answers[1];
                        item.image_url = (answers[2] && answers[2].toLowerCase() !== 'skip' && (answers[2].startsWith('http://') || answers[2].startsWith('https://'))) ? answers[2] : null;

                        const { data, error } = await supabase
                            .from('items')
                            .insert([item])
                            .select()
                            .single();

                        if (error) {
                            console.error("Error adding item to Supabase:", error);
                            return message.channel.send("There was an error adding the item. Please try again.");
                        }
                        await message.channel.send(`✅ Item "${data.name}" (ID: ${data.id}) added successfully!`);
                    } else if (reason === 'time') {
                        await message.channel.send("Item addition timed out.");
                    } else if (reason !== 'cancelled') {
                        await message.channel.send("Something went wrong during item addition.");
                    }
                });

            } catch (err) {
                console.error("Error in additem command:", err);
                message.reply("An error occurred.");
            }
        } else if (command === 'items') {
            if (!isAdmin(message.author.id)) return message.reply("You are not authorized to use this command.");
            try {
                const { data, error } = await supabase.from('items').select('id, name, description');
                if (error) throw error;

                if (!data || data.length === 0) {
                    return message.channel.send("No items found in the database.");
                }

                let response = "📦 **Available Giveaway Items:**\n\n";
                data.forEach(item => {
                    response += `**ID:** ${item.id}\n**Name:** ${item.name}\n**Description:** ${item.description || 'N/A'}\n--------------------\n`;
                });

                if (response.length > 2000) {
                    // Handle pagination if necessary, for now, just send what fits or split manually
                    message.channel.send(response.substring(0, 1990) + "...");
                    // Potentially send multiple messages
                } else {
                    message.channel.send(response);
                }
            } catch (err) {
                console.error("Error fetching items:", err);
                message.channel.send("Error fetching items. See console for details.");
            }
        }
    }
    // --- ADMIN SERVER COMMANDS ---
    else if (!isDM) { // Commands used in a server channel
        if (command === 'giveaway') {
            if (!isAdmin(message.author.id)) return message.reply("You are not authorized to start giveaways.");
            if (args.length < 3) {
                return message.reply(`Usage: ${PREFIX}giveaway <item_id> <end_time HH:MMAM/PM> <winners_count>`);
            }

            const itemId = parseInt(args[0]);
            const endTimeString = args[1].toUpperCase();
            const winnersCount = parseInt(args[2]);

            if (isNaN(itemId) || itemId <= 0) return message.reply("Invalid item ID.");
            if (isNaN(winnersCount) || winnersCount <= 0) return message.reply("Invalid number of winners.");

            const endTimeUTC = parseEndTime(endTimeString);
            if (!endTimeUTC) return message.reply("Invalid time format. Use HH:MMAM or HH:MMPM (e.g., 9:00AM or 10:30PM).");

            if (endTimeUTC <= new Date()) { // Check if parsed time is in the past
                return message.reply("The end time cannot be in the past.");
            }

            try {
                const { data: itemData, error: itemError } = await supabase
                    .from('items')
                    .select('name, description, image_url')
                    .eq('id', itemId)
                    .single();

                if (itemError || !itemData) {
                    console.error("Error fetching item or item not found:", itemError);
                    return message.reply(`Item with ID ${itemId} not found.`);
                }

                const formattedEndTime = formatInTimeZone(endTimeUTC, NIGERIA_TIMEZONE, 'MMM d, yyyy h:mm a zzzz'); // e.g. May 30, 2025 9:00 AM GMT+01:00

                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`🎁 ${itemData.name}`)
                    .setDescription(`${itemData.description || 'Click the button below to enter!'}\n\nEnds: **${formattedEndTime}**\nWinners: **${winnersCount}**`)
                    .setTimestamp(endTimeUTC); // Sets embed timestamp to end time

                if (itemData.image_url) {
                    embed.setImage(itemData.image_url);
                }

                const participateButton = new ButtonBuilder()
                    .setCustomId('participate_giveaway')
                    .setLabel('🎁 Participate (0)')
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(participateButton);

                const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });
                embed.setFooter({ text: `Giveaway ID: ${giveawayMsg.id}` }); // Add ID after msg is sent
                await giveawayMsg.edit({ embeds: [embed], components: [row] }); // Edit to include ID

                const { error: giveawaySaveError } = await supabase
                    .from('giveaways')
                    .insert({
                        message_id: giveawayMsg.id,
                        guild_id: message.guild.id,
                        channel_id: message.channel.id,
                        item_id: itemId,
                        end_time: endTimeUTC.toISOString(),
                        winners_count: winnersCount,
                        status: 'active',
                        participants: []
                    });

                if (giveawaySaveError) {
                    console.error("Error saving giveaway to Supabase:", giveawaySaveError);
                    await giveawayMsg.delete(); // Clean up message if DB save fails
                    return message.reply("Failed to save giveaway details. Please try again.");
                }
                 // No need to reply, the embed is the confirmation
            } catch (err) {
                console.error("Error starting giveaway:", err);
                message.reply("An error occurred while starting the giveaway.");
            }

        } else if (command === 'cancel') {
            if (!isAdmin(message.author.id)) return message.reply("You are not authorized to cancel giveaways.");
            if (args.length < 1) return message.reply(`Usage: ${PREFIX}cancel <giveaway_id (message_id)>`);

            const giveawayIdToCancel = args[0];

            try {
                const { data: giveawayData, error: fetchError } = await supabase
                    .from('giveaways')
                    .select('channel_id, status, item_id, winners_count')
                    .eq('message_id', giveawayIdToCancel)
                    .single();

                if (fetchError || !giveawayData) {
                    return message.reply(`Giveaway with ID ${giveawayIdToCancel} not found or already processed.`);
                }
                if (giveawayData.status !== 'active') {
                    return message.reply(`Giveaway ${giveawayIdToCancel} is not active (current status: ${giveawayData.status}).`);
                }

                const { error: updateError } = await supabase
                    .from('giveaways')
                    .update({ status: 'cancelled' })
                    .eq('message_id', giveawayIdToCancel);

                if (updateError) throw updateError;

                const giveawayChannel = await client.channels.fetch(giveawayData.channel_id);
                if (!giveawayChannel) {
                    console.warn(`Could not fetch channel ${giveawayData.channel_id} for cancelled giveaway ${giveawayIdToCancel}`);
                    return message.reply(`Cancelled giveaway ${giveawayIdToCancel} in database, but couldn't fetch original message channel.`);
                }
                const originalMessage = await giveawayChannel.messages.fetch(giveawayIdToCancel).catch(() => null);

                if (originalMessage) {
                    const originalEmbed = originalMessage.embeds[0];
                    if (originalEmbed) {
                         const cancelledEmbed = EmbedBuilder.from(originalEmbed) // Create from existing
                            .setTitle(`🚫 CANCELLED: ${originalEmbed.title.replace('🎁 ','')}`)
                            .setDescription(`This giveaway has been cancelled by an admin.\n\n~~${originalEmbed.description}~~`)
                            .setColor(0xFF0000); // Red for cancelled

                        const disabledButton = ButtonBuilder.from(originalMessage.components[0].components[0]) // Assuming it's the first button
                            .setDisabled(true)
                            .setLabel('🔒 Cancelled');

                        const row = new ActionRowBuilder().addComponents(disabledButton);
                        await originalMessage.edit({ embeds: [cancelledEmbed], components: [row] });
                    }
                }
                message.reply(`Giveaway ${giveawayIdToCancel} has been cancelled.`);

            } catch (err) {
                console.error("Error cancelling giveaway:", err);
                message.reply("An error occurred while cancelling the giveaway.");
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || interaction.customId !== 'participate_giveaway') return;

    const giveawayMessageId = interaction.message.id;
    const userId = interaction.user.id;

    try {
        // Fetch current participants and status
        const { data: giveaway, error: fetchError } = await supabase
            .from('giveaways')
            .select('participants, status, end_time')
            .eq('message_id', giveawayMessageId)
            .single();

        if (fetchError || !giveaway) {
            return interaction.reply({ content: 'Could not find this giveaway in the database.', ephemeral: true });
        }

        if (giveaway.status !== 'active') {
            return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
        }
        
        if (new Date(giveaway.end_time) <= new Date()) {
             return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        }

        if (giveaway.participants.includes(userId)) {
            return interaction.reply({ content: 'You have already participated in this giveaway!', ephemeral: true });
        }

        // Add participant
        const updatedParticipants = [...giveaway.participants, userId];
        const { error: updateError } = await supabase
            .from('giveaways')
            .update({ participants: updatedParticipants })
            .eq('message_id', giveawayMessageId);

        if (updateError) {
            console.error("Error updating participants:", updateError);
            return interaction.reply({ content: 'There was an error registering your participation. Please try again.', ephemeral: true });
        }

        // Update button label
        const originalButton = interaction.message.components[0].components[0];
        const updatedButton = ButtonBuilder.from(originalButton)
            .setLabel(`🎁 Participate (${updatedParticipants.length})`);
        const row = new ActionRowBuilder().addComponents(updatedButton);

        await interaction.message.edit({ components: [row] });
        await interaction.reply({ content: 'You have successfully joined the giveaway! 🎉', ephemeral: true });

    } catch (err) {
        console.error("Error handling participation button:", err);
        await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true }).catch(() => {}); // Catch if interaction already replied
    }
});

async function checkEndedGiveaways() {
    const nowUTC = new Date().toISOString();
    // console.log(`Checking for ended giveaways at ${nowUTC}...`);

    const { data: endedGiveaways, error: fetchError } = await supabase
        .from('giveaways')
        .select('*') // Select all fields needed for processing
        .eq('status', 'active')
        .lt('end_time', nowUTC); // Less than current time means it has ended

    if (fetchError) {
        console.error("Error fetching ended giveaways:", fetchError);
        return;
    }

    if (!endedGiveaways || endedGiveaways.length === 0) {
        // console.log("No active giveaways have ended.");
        return;
    }

    for (const giveaway of endedGiveaways) {
        console.log(`Processing ended giveaway: ${giveaway.message_id}`);
        let winners = [];
        const participants = giveaway.participants || [];

        if (participants.length > 0) {
            if (participants.length <= giveaway.winners_count) {
                winners = [...participants]; // All participants win if fewer than winner_count
            } else {
                // Shuffle participants and pick winners
                const shuffled = [...participants].sort(() => 0.5 - Math.random());
                winners = shuffled.slice(0, giveaway.winners_count);
            }
        }

        // Update giveaway status and store winners
        const { error: updateError } = await supabase
            .from('giveaways')
            .update({ status: 'ended', winner_ids: winners })
            .eq('message_id', giveaway.message_id);

        if (updateError) {
            console.error(`Error updating giveaway ${giveaway.message_id} to ended:`, updateError);
            continue; // Skip to next giveaway if update fails
        }

        // Fetch the original message to edit
        try {
            const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
            if (!channel) {
                console.warn(`Could not fetch channel ${giveaway.channel_id} for giveaway ${giveaway.message_id}`);
                continue;
            }
            const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!message) {
                console.warn(`Could not fetch message ${giveaway.message_id} in channel ${giveaway.channel_id}`);
                continue;
            }

            const itemDetails = await supabase.from('items').select('name').eq('id', giveaway.item_id).single();
            const itemName = itemDetails.data ? itemDetails.data.name : "the prize";

            const originalEmbed = message.embeds[0];
            const endedEmbed = EmbedBuilder.from(originalEmbed) // Create from existing
                .setTitle(`🎉 ENDED: ${originalEmbed.title.replace('🎁 ','')}`)
                .setColor(0x57F287); // Green for ended

            let description = originalEmbed.description;
            // Remove old "Ends:" and "Winners:" lines to replace them cleanly
            description = description.replace(/Ends: .*\nWinners: .*\n?/, ''); // Regex to remove these lines

            if (winners.length > 0) {
                const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
                endedEmbed.setDescription(`${description}\n\n**🏆 Congratulations to the winner(s)!**\n${winnerMentions}`);
            } else {
                endedEmbed.setDescription(`${description}\n\n**😔 No participants joined this giveaway.**`);
            }

            const disabledButton = ButtonBuilder.from(message.components[0].components[0])
                .setDisabled(true)
                .setLabel('🔒 Ended');
            if (participants.length > 0) { // Keep participant count if there were any
                 disabledButton.setLabel(`🎁 Ended (${participants.length})`);
            }


            const row = new ActionRowBuilder().addComponents(disabledButton);

            await message.edit({ embeds: [endedEmbed], components: [row] });

            // Announce winners by mentioning them in a new message (as per common practice, though spec says edit original)
            // Spec says: "Announces the winners by mentioning them" (in the edited message)
            // The above edit includes mentions. If a separate message is desired, uncomment below.
            // if (winners.length > 0) {
            //    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            //    await channel.send(`Congratulations ${winnerMentions}! You won **${itemName}** from giveaway ID ${giveaway.message_id}!`);
            // }

            console.log(`Giveaway ${giveaway.message_id} ended. Winners: ${winners.join(', ')}`);

        } catch (err) {
            console.error(`Error finalizing giveaway ${giveaway.message_id} on Discord:`, err);
        }
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("Shutting down bot...");
    client.destroy();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log("Shutting down bot...");
    client.destroy();
    process.exit(0);
});


client.login(BOT_TOKEN).catch(err => {
    console.error("Failed to login to Discord:", err);
    process.exit(1);
});
