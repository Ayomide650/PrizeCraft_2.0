const { Client, GatewayIntentBits, Collection } = require('discord.js');
const supabase = require('./supabase');
const cron = require('node-cron');
const { 
    isAdmin, 
    parseTimeToNigeria, 
    createGiveawayEmbed, 
    createGiveawayButton,
    createEndedGiveawayEmbed,
    createCancelledGiveawayEmbed,
    selectRandomWinners 
} = require('./utils');
require('./server'); // Start Express server

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Store ongoing item creation processes
const itemCreationProcess = new Collection();

// Bot ready event
client.once('ready', () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    
    // Start giveaway checker (runs every minute)
    cron.schedule('* * * * *', checkExpiredGiveaways);
});

// Message event handler
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const isDM = !message.guild;
    const isAdmin = checkAdmin(message.author.id);
    
    // Handle item creation process in DMs
    if (isDM && itemCreationProcess.has(message.author.id)) {
        await handleItemCreationStep(message);
        return;
    }
    
    if (!message.content.startsWith('.')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    try {
        switch (command) {
            case 'additem':
                if (!isDM) {
                    return message.reply('❌ This command can only be used in DMs with the bot.');
                }
                if (!isAdmin) {
                    return message.reply('❌ You are not authorized to use this command.');
                }
                await handleAddItem(message);
                break;
                
            case 'items':
                if (!isDM) {
                    return message.reply('❌ This command can only be used in DMs with the bot.');
                }
                if (!isAdmin) {
                    return message.reply('❌ You are not authorized to use this command.');
                }
                await handleListItems(message);
                break;
                
            case 'giveaway':
                if (isDM) {
                    return message.reply('❌ This command can only be used in server channels.');
                }
                if (!isAdmin) {
                    return message.reply('❌ You are not authorized to use this command.');
                }
                await handleStartGiveaway(message, args);
                break;
                
            case 'cancel':
                if (isDM) {
                    return message.reply('❌ This command can only be used in server channels.');
                }
                if (!isAdmin) {
                    return message.reply('❌ You are not authorized to use this command.');
                }
                await handleCancelGiveaway(message, args);
                break;
        }
    } catch (error) {
        console.error('Command error:', error);
        message.reply('❌ An error occurred while processing your command.');
    }
});

// Button interaction handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'participate_giveaway') {
        await handleGiveawayParticipation(interaction);
    }
});

// Check if user is admin
function checkAdmin(userId) {
    return isAdmin(userId);
}

// Handle add item command
async function handleAddItem(message) {
    itemCreationProcess.set(message.author.id, { step: 'name' });
    await message.reply('🎁 **Adding new giveaway item**\n\nPlease enter the **item name**:');
}

// Handle item creation steps
async function handleItemCreationStep(message) {
    const process = itemCreationProcess.get(message.author.id);
    
    switch (process.step) {
        case 'name':
            process.name = message.content.trim();
            process.step = 'description';
            await message.reply('📝 **Item name saved!**\n\nNow enter the **description** for this item:');
            break;
            
        case 'description':
            process.description = message.content.trim();
            process.step = 'image';
            await message.reply('🖼️ **Description saved!**\n\nNow send an **image URL** for this item (or type "skip" to skip):');
            break;
            
        case 'image':
            const imageUrl = message.content.trim().toLowerCase() === 'skip' ? null : message.content.trim();
            
            try {
                const { data, error } = await supabase
                    .from('items')
                    .insert({
                        name: process.name,
                        description: process.description,
                        image_url: imageUrl
                    })
                    .select()
                    .single();
                
                if (error) throw error;
                
                itemCreationProcess.delete(message.author.id);
                
                await message.reply(`✅ **Item created successfully!**\n\n**ID:** ${data.id}\n**Name:** ${data.name}\n**Description:** ${data.description}\n**Image:** ${data.image_url || 'None'}`);
            } catch (error) {
                console.error('Error creating item:', error);
                itemCreationProcess.delete(message.author.id);
                await message.reply('❌ Failed to create item. Please try again.');
            }
            break;
    }
    
    itemCreationProcess.set(message.author.id, process);
}

// Handle list items command
async function handleListItems(message) {
    try {
        const { data: items, error } = await supabase
            .from('items')
            .select('*')
            .order('id', { ascending: true });
        
        if (error) throw error;
        
        if (items.length === 0) {
            return message.reply('📦 No items found. Use `.additem` to add your first item.');
        }
        
        const itemList = items.map(item => 
            `**ID ${item.id}:** ${item.name}\n📝 ${item.description}\n🖼️ ${item.image_url || 'No image'}`
        ).join('\n\n');
        
        await message.reply(`📦 **Available Giveaway Items:**\n\n${itemList}`);
    } catch (error) {
        console.error('Error fetching items:', error);
        message.reply('❌ Failed to fetch items.');
    }
}

// Handle start giveaway command
async function handleStartGiveaway(message, args) {
    if (args.length !== 3) {
        return message.reply('❌ **Usage:** `.giveaway <item_id> <end_time> <winners_count>`\n**Example:** `.giveaway 1 9:00AM 2`');
    }
    
    const [itemId, timeStr, winnersStr] = args;
    
    try {
        // Validate item ID
        const itemIdNum = parseInt(itemId);
        if (isNaN(itemIdNum)) {
            return message.reply('❌ Invalid item ID. It must be a number.');
        }
        
        // Validate winners count
        const winnersCount = parseInt(winnersStr);
        if (isNaN(winnersCount) || winnersCount < 1) {
            return message.reply('❌ Winners count must be a positive number.');
        }
        
        // Parse end time
        const endTime = parseTimeToNigeria(timeStr);
        
        // Get item from database
        const { data: item, error: itemError } = await supabase
            .from('items')
            .select('*')
            .eq('id', itemIdNum)
            .single();
        
        if (itemError || !item) {
            return message.reply('❌ Item not found. Use `.items` to see available items.');
        }
        
        // Create giveaway embed and button
        const embed = createGiveawayEmbed(item, endTime, winnersCount, 0);
        const button = createGiveawayButton(0);
        
        // Send giveaway message
        const giveawayMessage = await message.channel.send({
            embeds: [embed],
            components: [button]
        });
        
        // Save giveaway to database
        const { data: giveaway, error: giveawayError } = await supabase
            .from('giveaways')
            .insert({
                item_id: itemIdNum,
                channel_id: message.channel.id,
                message_id: giveawayMessage.id,
                guild_id: message.guild.id,
                end_time: endTime.toISOString(),
                winners_count: winnersCount,
                created_by: message.author.id
            })
            .select()
            .single();
        
        if (giveawayError) throw giveawayError;
        
        // Update embed with giveaway ID
        const updatedEmbed = createGiveawayEmbed(item, endTime, winnersCount, 0, giveaway.id);
        await giveawayMessage.edit({
            embeds: [updatedEmbed],
            components: [button]
        });
        
        await message.reply(`✅ Giveaway started successfully! **Giveaway ID:** ${giveaway.id}`);
        
    } catch (error) {
        console.error('Error starting giveaway:', error);
        message.reply(`❌ ${error.message || 'Failed to start giveaway.'}`);
    }
}

// Handle cancel giveaway command
async function handleCancelGiveaway(message, args) {
    if (args.length !== 1) {
        return message.reply('❌ **Usage:** `.cancel <giveaway_id>`\n**Example:** `.cancel 5`');
    }
    
    const giveawayId = parseInt(args[0]);
    
    if (isNaN(giveawayId)) {
        return message.reply('❌ Invalid giveaway ID. It must be a number.');
    }
    
    try {
        // Get giveaway from database
        const { data: giveaway, error: giveawayError } = await supabase
            .from('giveaways')
            .select(`
                *,
                items (*)
            `)
            .eq('id', giveawayId)
            .eq('status', 'active')
            .single();
        
        if (giveawayError || !giveaway) {
            return message.reply('❌ Giveaway not found or already ended/cancelled.');
        }
        
        // Get participant count
        const { count: participantCount } = await supabase
            .from('giveaway_participants')
            .select('*', { count: 'exact', head: true })
            .eq('giveaway_id', giveawayId);
        
        // Update giveaway status
        await supabase
            .from('giveaways')
            .update({ status: 'cancelled' })
            .eq('id', giveawayId);
        
        // Update original message
        const channel = await client.channels.fetch(giveaway.channel_id);
        const giveawayMessage = await channel.messages.fetch(giveaway.message_id);
        
        const cancelledEmbed = createCancelledGiveawayEmbed(giveaway.items, participantCount, giveawayId);
        const disabledButton = createGiveawayButton(participantCount, true);
        
        await giveawayMessage.edit({
            embeds: [cancelledEmbed],
            components: [disabledButton]
        });
        
        await message.reply(`✅ Giveaway #${giveawayId} has been cancelled.`);
        
    } catch (error) {
        console.error('Error cancelling giveaway:', error);
        message.reply('❌ Failed to cancel giveaway.');
    }
}

// Handle giveaway participation
async function handleGiveawayParticipation(interaction) {
    try {
        // Get giveaway from database using message ID
        const { data: giveaway, error: giveawayError } = await supabase
            .from('giveaways')
            .select(`
                *,
                items (*)
            `)
            .eq('message_id', interaction.message.id)
            .eq('status', 'active')
            .single();
        
        if (giveawayError || !giveaway) {
            return interaction.reply({ content: '❌ This giveaway is no longer active.', ephemeral: true });
        }
        
        // Check if giveaway has ended
        if (new Date() >= new Date(giveaway.end_time)) {
            return interaction.reply({ content: '❌ This giveaway has already ended.', ephemeral: true });
        }
        
        // Try to add participant
        const { error: participantError } = await supabase
            .from('giveaway_participants')
            .insert({
                giveaway_id: giveaway.id,
                user_id: interaction.user.id
            });
        
        if (participantError) {
            if (participantError.code === '23505') { // Unique constraint violation
                return interaction.reply({ content: '❌ You are already participating in this giveaway!', ephemeral: true });
            }
            throw participantError;
        }
        
        // Get updated participant count
        const { count: participantCount } = await supabase
            .from('giveaway_participants')
            .select('*', { count: 'exact', head: true })
            .eq('giveaway_id', giveaway.id);
        
        // Update message with new participant count
        const updatedEmbed = createGiveawayEmbed(giveaway.items, new Date(giveaway.end_time), giveaway.winners_count, participantCount, giveaway.id);
        const updatedButton = createGiveawayButton(participantCount);
        
        await interaction.update({
            embeds: [updatedEmbed],
            components: [updatedButton]
        });
        
        await interaction.followUp({ content: '✅ You have successfully joined the giveaway!', ephemeral: true });
        
    } catch (error) {
        console.error('Error handling participation:', error);
        interaction.reply({ content: '❌ Failed to join giveaway. Please try again.', ephemeral: true });
    }
}

// Check for expired giveaways
async function checkExpiredGiveaways() {
    try {
        const { data: expiredGiveaways, error } = await supabase
            .from('giveaways')
            .select(`
                *,
                items (*)
            `)
            .eq('status', 'active')
            .lt('end_time', new Date().toISOString());
        
        if (error) throw error;
        
        for (const giveaway of expiredGiveaways) {
            await endGiveaway(giveaway);
        }
        
    } catch (error) {
        console.error('Error checking expired giveaways:', error);
    }
}

// End a giveaway
async function endGiveaway(giveaway) {
    try {
        // Get all participants
        const { data: participants, error: participantsError } = await supabase
            .from('giveaway_participants')
            .select('user_id')
            .eq('giveaway_id', giveaway.id);
        
        if (participantsError) throw participantsError;
        
        // Select winners
        const participantIds = participants.map(p => p.user_id);
        const winners = selectRandomWinners(participantIds, giveaway.winners_count);
        
        // Save winners to database
        if (winners.length > 0) {
            const winnerData = winners.map(userId => ({
                giveaway_id: giveaway.id,
                user_id: userId
            }));
            
            await supabase.from('giveaway_winners').insert(winnerData);
        }
        
        // Update giveaway status
        await supabase
            .from('giveaways')
            .update({ status: 'ended' })
            .eq('id', giveaway.id);
        
        // Update original message
        const channel = await client.channels.fetch(giveaway.channel_id);
        const giveawayMessage = await channel.messages.fetch(giveaway.message_id);
        
        const endedEmbed = createEndedGiveawayEmbed(giveaway.items, winners, participants.length, giveaway.id);
        const disabledButton = createGiveawayButton(participants.length, true);
        
        await giveawayMessage.edit({
            embeds: [endedEmbed],
            components: [disabledButton]
        });
        
        console.log(`✅ Giveaway #${giveaway.id} ended. Winners: ${winners.length}`);
        
    } catch (error) {
        console.error(`Error ending giveaway #${giveaway.id}:`, error);
    }
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
