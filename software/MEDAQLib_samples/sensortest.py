import sys			# sys.exit(), sys.agrv
if windows:
    from msvcrt import kbhit
from MEDAQLib import MEDAQLib, ERR_CODE, ME_SENSOR

vals_per_frame = 0

# Print short help on console
def usage():
	print('Usage:\npython3 sensor_test.py <Sensor name> [InterfaceParam=Value] ...')
	print('If a parameter contains a space, it must be quoted by "...".')
	print('Examples:')
	print('python3 sensor_test.py ILD2300 (will use SensorFinder to detect ILD2300)')


# Helper function to set cursor at start of current line in console
# and clear its previous content.
def clear_line():
	print('\r', end='') # Jump at start of line, next print will overwrite old content

# Show current progress in console.
def show_progress(progress):
	print(f'\rProgress: {progress:.2f}', end='', flush=True)


# Close and release sensor instance
def clean_up(sensor_object, ret_code = 0):
	if sensor_object.iSensor != 0:
		sensor_object.CloseSensor()
		sensor_object.ReleaseSensorInstance()
	return ret_code

# Connect to sensor
def open(sensor_object):
	print('Connecting to sensor')
	sensor_object.OpenSensor()

# Convert a parity enum to a string
def parity_to_string(parity):
	strings = [
		"No parity",
		"Odd parity",
		"Even parity",
		"Mark parity",
		"Space parity",
		"Invalid parity"
	]
#    parity = min(parity, len(strings))
	return strings[parity]

# Convert a stop bit enum to a string
def stopbits_to_string(stopbits):
	strings = [
		"One stop bit",
		"One point five stop bits",
		"Two stop bits",
		"Invalid stop bits"
	]
	if stopbits < len(strings):
		return strings[stopbits]
	else:
		return strings.pop()

# Print RS232 interface parameters at console
def print_RS232(sensor_object):
	port = sensor_object.GetParameterString("IP_Port")
	baudrate = sensor_object.GetParameterInt("IP_Baudrate")
	byte_size = sensor_object.GetParameterInt("IP_ByteSize")
	parity = sensor_object.GetParameterInt("IP_Parity")
	stopbits = sensor_object.GetParameterInt("IP_Stopbits")
	print(f'{port}, {baudrate!s} Baud, {byte_size!s} data bits, ' + parity_to_string(parity) + ', ' + stopbits_to_string(stopbits), end='')
	sensor_address = sensor_object.GetParameterInt("IP_SensorAddress")
	if sensor_object.GetLastError() == ERR_CODE.ERR_NOERROR:
		print(f', RS485 addr: {sensor_address!s}', end='')
	return True

# Print TCP/IP interface parameters at console
def print_TCPIP(sensor_object):
	ip_address = sensor_object.GetParameterString("IP_RemoteAddr")
	print(ip_address, end='')
	return True

# Print USB interface parameters at console
def print_USB(sensor_object):
	device_instance = sensor_object.GetParameterInt("IP_DeviceInstance")
	print(f'Instance {device_instance!s}', end='')
	return True

# Print IF2004_USB paramters at console
def print_IF2004_USB(sensor_object):
	device_instance = sensor_object.GetParameterInt("IP_DeviceInstance")
	channel_number = sensor_object.GetParameterInt("IP_ChannelNumber")
	port = sensor_object.GetParameterString("IP_Port")
	serial_number = sensor_object.GetParameterString("IP_SerialNumber")
	baudrate = sensor_object.GetParameterInt("IP_Baudrate")
	print(f'Device {device_instance!s} (SN{serial_number}, {port}), Channel {channel_number!s}, {baudrate!s} Baud', end='')
	return True

# Print IF2008 interface parameters at console
def print_IF2008(sensor_object):
	card_instance = sensor_object.GetParameterInt("IP_CardInstance")
	channel_number = sensor_object.GetParameterInt("IP_ChannelNumber")
	baudrate = sensor_object.GetParameterInt("IP_Baudrate")
	parity = sensor_object.GetParameterInt("IP_Parity")
	print(f'Card {card_instance!s}, Channel {channel_number!s}, {baudrate!s} Baud, ' + parity_to_string(parity), end='')
	return True

# Print IF2008_ETH interface parameters at console
def print_IF2008_ETH(sensor_object, show_sensor_param):
	ip_address = sensor_object.GetParameterString("IP_RemoteAddr")
	channel_number = sensor_object.GetParameterInt("IP_ChannelNumber")
	print(f'{ip_address}, Channel {channel_number!s}', end='')
	if show_sensor_param == True:
		baudrate = sensor_object.GetParameterInt("IP_Baudrate")
		print(f', {baudrate!s} Baud', end='')
	return True

# Show one result of SensorFinder at console
def show_found_sensor(sensor_object, sensor_index):
	sensor_object.SetIntExecSCmd("Get_FoundSensor", "IP_Index", sensor_index-1)
	sensor_type = sensor_object.GetParameterInt("IP_SensorType")
	sensor_type_name = sensor_object.GetParameterString("IP_SensorTypeName")
	hardware_interface = sensor_object.GetParameterInt("IP_InterfaceIdx")
	hw_interface_name = sensor_object.GetParameterString("IP_Interface")
	print(f'{sensor_index!s}: {sensor_type_name} at {hw_interface_name} ', end='')
	match hardware_interface:
		case  1:
			if print_RS232(sensor_object) is False:
				return False
		case  3:
			if print_TCPIP(sensor_object) is False:
				return False
		case  4:
			if print_USB(sensor_object) is False:
				return False
		case  5:
			if print_USB(sensor_object) is False:
				return False
		case  6:
			if print_IF2008(sensor_object) is False:
				return False
		case  7:
			if print_USB(sensor_object) is False:
				return False
		case  8:
			if print_IF2004_USB(sensor_object) is False:
				return False
		case 10:
			if print_IF2008_ETH(sensor_object, sensor_type != ME_SENSOR.ETH_ADAPTER_IF2008) is False:
				return False
	print(')', end='')
	serial_number = sensor_object.GetParameterString("SA_SerialNumber")
	if sensor_object.GetLastError() == ERR_CODE.ERR_NOERROR:
		print(f', Serial number {serial_number}', end='')
	print('\n', end='')
	return True

# Search for specified sensor at any interface and selects one sensor
def sensor_finder(sensor_object):
	enable_logging = sensor_object.GetParameterInt("IP_EnableLogging")
	if enable_logging == False:
		sensor_object.SetParameterInt("IP_EnableLogging", 1)
	print('Scanning for sensors')
	progress = 0.0
	found = 0
	processed = 0
	show_progress(progress)

	sensor_object.ExecSCmd("Start_FindSensor")
	while progress < 100.0:
		sensor_object.SetIntExecSCmd("Exec_SleepTime", "IP_SleepTime", 50) 	# 50 ms
		progress = sensor_object.ExecSCmdGetDouble("Get_FindSensorProgress", "IA_Progress")
		found = sensor_object.GetParameterInt("IA_Found")
		while(found>processed):
			clear_line()
			processed = processed+1
			if show_found_sensor(sensor_object, processed) is False:
				return False
		show_progress(progress)
	print('')
	clear_line()
	sensor_index = -1
	if found <= 0:
		print('Specified sensor is not found')
		return False
	elif found == 1:
		sensor_index = 0
	else: 	# more sensors found
		sensor_index = input('Please type sensor index <CR> to open sensor: ')
		if (sensor_index.isnumeric() is False) or (int(sensor_index) < 0) or (int(sensor_index) >= found):
			print('No valid sensor selected')
			return False
		sensor_index = int(sensor_index)
	# Following function requests all interface parameters for selected sensor. Now it can be used at OpenSensor.
	sensor_object.SetIntExecSCmd("Get_FoundSensor", "IP_Index", sensor_index)
	similar_sensor = sensor_object.GetParameterInt("IP_SimilarSensor")
	if similar_sensor != 0:
		sensor_type = ME_SENSOR.NO_SENSOR
		sensor_type = sensor_object.GetParameterInt("IP_SensorType")
		parameters = sensor_object.GetParameters()
		sensor_object.ReleaseSensorInstance()
		sensor_object.CreateSensorInstance(sensor_type)
		sensor_object.SetParameters(parameters)
	return True

# Retrieve information about transmitted data from sensor and show it at console
def get_transmitted_data_info(sensor_object):
	global vals_per_frame
	vals_per_frame = sensor_object.ExecSCmdGetInt("Get_TransmittedDataInfo", "IA_ValuesPerFrame")
	max_vals_per_frame = sensor_object.GetParameterInt("IA_MaxValuesPerFrame")
	max_output_index = sensor_object.GetParameterInt("IA_MaxOutputIndex")

	print(f'Sensor transmits {vals_per_frame!s} of {max_vals_per_frame!s} possible values, maximum output index is {max_output_index!s}')
	for i in range(vals_per_frame):
		raw_name = sensor_object.GetParameterString("IA_Raw_Name" + str(i+1))
		scaled_name = sensor_object.GetParameterString("IA_Scaled_Name" + str(i+1))
		raw_unit = sensor_object.GetParameterString("IA_Raw_Unit" + str(i+1))
		scaled_unit = sensor_object.GetParameterString("IA_Scaled_Unit" + str(i+1))
		index = sensor_object.GetParameterInt("IA_Index" + str(i+1))
		raw_range_min = sensor_object.GetParameterDouble("IA_Raw_RangeMin" + str(i+1))
		scaled_range_min = sensor_object.GetParameterDouble("IA_Scaled_RangeMin" + str(i+1))
		raw_range_max = sensor_object.GetParameterDouble("IA_Raw_RangeMax" + str(i+1))
		scaled_range_max = sensor_object.GetParameterDouble("IA_Scaled_RangeMax" + str(i+1))
		print(f" {index:2d}: {raw_name} [{raw_range_min:.1f} .. {raw_range_max:.1f} {raw_unit}], {scaled_name} [{scaled_range_min!s} .. {scaled_range_max!s} {scaled_unit}]")

	sample_rate = sensor_object.GetParameterDouble("IA_Samplerate")
	data_rate = sensor_object.GetParameterDouble("IA_Datarate")
	print(f'Samplerate: {sample_rate:.1f} Hz, Datarate: {data_rate:.1f} Hz')

	return True

def output_time_reached(sensor_object):
	output_interval = 100
	actual = sensor_object.ExecSCmdGetDouble("Get_HighResolutionTime", "IA_HighResolutionTime")
	if (actual - output_time_reached.last_time) >= output_interval:
		output_time_reached.last_time = actual
		return True
	else:
		return False
output_time_reached.last_time = 0

# Read continuous data from sensor and show each first frame at console
def get_data(sensor_object):
	buf_size = 15000
	sleep_time = 50
	global vals_per_frame
	while not kbhit():
		sensor_object.SetIntExecSCmd("Exec_SleepTime", "IP_SleepTime", sleep_time)
        if (sensorIsMEBus)
            sensor_object.ExecSCmd("Get_Measure")
		avail = sensor_object.DataAvail()
		if avail < vals_per_frame:
			continue
		read = avail
		if read > buf_size:
			read = buf_size
		data = sensor_object.TransferDataTs(buf_size)
		raw_data = data[0]
		scaled_data = data[1]
		read = data[2]
		timestamp = data[3]
		if read < vals_per_frame:
			print(f'Error at "sensor_object.TransferDataTs(buf_size)"\nTo less values {read!s} was read.')
			return False
		if output_time_reached(sensor_object):
			clear_line()
			print(f'[{read:4d}/{avail:4d}] ', end='', flush=True)
			for i in range(vals_per_frame):
				if scaled_data[i] == sys.float_info.min:
					print(f'{raw_data[i]:13g} (error value)', end='', flush=True)
				else:
					print(f'{raw_data[i]:13g} ({scaled_data[i]:13g})', end='', flush=True)

				if i < (vals_per_frame-1):
					print(', ', end='', flush=True)
			print(f', TS {timestamp:020.3f}', end='', flush=True)
	print('')
	return True

# Main SensorTest program
if (len(sys.argv) < 2):
	usage()
	sys.exit()

sensor_type_name = sys.argv[1]

sensor_object = MEDAQLib.CreateSensorInstByName(sensor_type_name)
print(f'SensorTest {sensor_type_name}')
if sensor_object.iSensor == 0:
	print(f'Cannot create MEDAQLib instance of sensor \'{sensor_type_name}\'!')
	clean_up(sensor_object, -2)

if sensor_finder(sensor_object) is False: # Start SensorFinder
	clean_up(sensor_object, -6)
	sys.exit()

if open(sensor_object) is False:
	clean_up(sensor_object, -9)
	sys.exit()

if get_transmitted_data_info(sensor_object) is False:
	clean_up(sensor_object, -10)
	sys.exit()

if get_data(sensor_object) is False:
	clean_up(sensor_object, -12)
	sys.exit()

clean_up(sensor_object)

"""
Different to the original program:
- No CHECK_ERROR
- can not parse an additional file with sensorcommands
- does not measure the real datarate of received signal
- does not check monotony for counter values
"""
