import { render } from '@testing-library/react-native'
import { Text, View } from 'react-native'

test('Jest + RN preset renders a vanilla View', () => {
  const { getByTestId } = render(
    <View testID="box">
      <Text>hello</Text>
    </View>,
  )
  expect(getByTestId('box')).toBeTruthy()
})
